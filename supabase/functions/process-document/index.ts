
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getGoogleAccessToken() {
  try {
    const credentialsString = Deno.env.get("GOOGLE_CLOUD_VISION_CREDENTIALS");
    if (!credentialsString) {
      throw new Error('No se encontraron las credenciales de Google Cloud Vision');
    }

    const credentials = JSON.parse(credentialsString);
    if (!credentials.private_key || !credentials.client_email) {
      throw new Error('Credenciales incompletas');
    }

    // Limpiar la private key (remover headers y footers PEM)
    const privateKey = credentials.private_key
      .replace('-----BEGIN PRIVATE KEY-----\n', '')
      .replace('\n-----END PRIVATE KEY-----\n', '')
      .replace(/\n/g, '');

    // Crear el JWT para OAuth
    const now = Math.floor(Date.now() / 1000);
    const jwt = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    };

    // Codificar header y payload
    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(jwt));
    
    // Convertir la private key de base64 a ArrayBuffer
    const binaryKey = Uint8Array.from(atob(privateKey), c => c.charCodeAt(0));
    
    // Importar la clave privada
    const key = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Firmar el JWT
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );

    const signedJwt = `${encodedHeader}.${encodedPayload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

    // Obtener el access token de Google OAuth
    console.log('Solicitando access token a Google OAuth...');
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signedJwt
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Error en respuesta de OAuth:', errorText);
      throw new Error(`Error en OAuth: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const { access_token } = await tokenResponse.json();
    console.log('Access token obtenido exitosamente');
    return access_token;

  } catch (error) {
    console.error('Error obteniendo access token:', error);
    throw error;
  }
}

async function performOCR(imageBase64: string, accessToken: string) {
  try {
    console.log('Iniciando llamada a Vision API...');
    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{
          image: {
            content: imageBase64
          },
          features: [{
            type: 'TEXT_DETECTION'
          }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error en respuesta de Vision API:', errorText);
      throw new Error(`Error en Vision API: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Respuesta de Vision API recibida exitosamente');
    return result.responses[0]?.fullTextAnnotation?.text || '';
  } catch (error) {
    console.error('Error en OCR:', error);
    throw error;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filename, contentType, fileData } = await req.json();
    console.log('Procesando archivo:', filename, 'tipo:', contentType);

    if (!fileData) {
      throw new Error('No se recibió contenido del archivo');
    }

    // Inicializar cliente Supabase
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Crear registro inicial del documento
    const { data: document, error: insertError } = await supabaseAdmin
      .from('documents')
      .insert({
        filename: filename,
        status: 'processing',
        content_type: contentType
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    console.log('Documento creado:', document.id);

    // Procesar el documento
    try {
      console.log('Obteniendo access token...');
      const accessToken = await getGoogleAccessToken();
      
      console.log('Realizando OCR...');
      const extractedText = await performOCR(fileData, accessToken);
      
      console.log('Texto extraído exitosamente, actualizando documento...');
      
      const { error: updateError } = await supabaseAdmin
        .from('documents')
        .update({
          processed_text: extractedText,
          status: 'processed',
          processed_at: new Date().toISOString(),
        })
        .eq('id', document.id);

      if (updateError) {
        throw updateError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          document: {
            id: document.id,
            filename: document.filename,
            status: 'processed'
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Error procesando documento:', error);
      
      // Actualizar estado de error en el documento
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'error',
          error: error.message
        })
        .eq('id', document.id);

      throw error;
    }
  } catch (error) {
    console.error('Error en process-document:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Error procesando el documento',
        details: error.message
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
