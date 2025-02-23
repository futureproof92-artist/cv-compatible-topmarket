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

    const privateKey = credentials.private_key
      .replace('-----BEGIN PRIVATE KEY-----\n', '')
      .replace('\n-----END PRIVATE KEY-----\n', '')
      .replace(/\n/g, '');

    const now = Math.floor(Date.now() / 1000);
    const jwt = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    };

    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(jwt));
    
    const binaryKey = Uint8Array.from(atob(privateKey), c => c.charCodeAt(0));
    
    const key = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );

    const signedJwt = `${encodedHeader}.${encodedPayload}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

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

async function performOCR(imageBase64: string, authToken: string) {
  try {
    if (!imageBase64) {
      throw new Error('No se proporcionó imagen para OCR');
    }

    console.log('Enviando a Google Vision API con base64:', imageBase64.substring(0, 100) + '...');
    
    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{
          image: { content: imageBase64 },
          features: [{ type: 'TEXT_DETECTION' }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error en la respuesta de Vision API:', errorText);
      throw new Error(`Error en Vision API: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Respuesta completa de Vision API:', JSON.stringify(result, null, 2));
    
    if (!result.responses || !result.responses[0]) {
      throw new Error('Respuesta de Vision API no contiene resultados');
    }

    const extractedText = result.responses[0]?.fullTextAnnotation?.text || '';
    
    if (!extractedText) {
      console.warn('No se detectó texto en la imagen');
      throw new Error('No se detectó texto en la imagen');
    }

    console.log(`Texto extraído (${extractedText.length} caracteres):`, extractedText.substring(0, 200) + '...');
    
    return extractedText;
  } catch (error) {
    console.error('Error en OCR:', error);
    throw error;
  }
}

async function processExtractedText(text: string | null | undefined): Promise<{
  processedText: string;
  status: 'processed' | 'error';
  metadata: {
    textLength: number;
    quality: 'success' | 'warning' | 'error';
    notes: string;
  };
}> {
  if (!text) {
    return {
      processedText: 'No se pudo extraer texto del documento',
      status: 'error',
      metadata: {
        textLength: 0,
        quality: 'error',
        notes: 'El texto extraído está vacío o es nulo'
      }
    };
  }

  // Limpieza básica del texto
  const cleanedText = text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Eliminar caracteres de control
    .replace(/\s+/g, ' ') // Normalizar espacios múltiples
    .trim();

  if (cleanedText.length < 50) {
    return {
      processedText: cleanedText || 'Texto extraído demasiado corto',
      status: 'error',
      metadata: {
        textLength: cleanedText.length,
        quality: 'warning',
        notes: 'El texto extraído es demasiado corto para ser válido'
      }
    };
  }

  return {
    processedText: cleanedText,
    status: 'processed',
    metadata: {
      textLength: cleanedText.length,
      quality: 'success',
      notes: `Texto extraído y procesado correctamente (${cleanedText.length} caracteres)`
    }
  };
}

async function updateDocumentWithText(supabaseAdmin: any, documentId: string, extractedText: string) {
  console.log(`Actualizando documento ${documentId} con texto extraído (${extractedText.length} caracteres)`);
  
  try {
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({
        processed_text: extractedText,
        status: 'processed',
        processed_at: new Date().toISOString(),
        text_length: extractedText.length,
        processing_metadata: {
          last_update: new Date().toISOString(),
          text_quality: 'success',
          processing_notes: `Texto extraído exitosamente con ${extractedText.length} caracteres`
        }
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Error actualizando documento:', updateError);
      throw updateError;
    }

    console.log('Documento actualizado exitosamente');
    return true;
  } catch (error) {
    console.error('Error en actualización de documento:', error);
    
    // Intentar actualizar el estado a error
    try {
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'error',
          error: error.message,
          processed_at: new Date().toISOString(),
          processing_metadata: {
            last_update: new Date().toISOString(),
            text_quality: 'error',
            processing_notes: `Error en procesamiento: ${error.message}`
          }
        })
        .eq('id', documentId);
    } catch (secondaryError) {
      console.error('Error actualizando estado de error:', secondaryError);
    }
    
    throw error;
  }
}

function generateSecureFilePath(filename: string, uuid: string): string {
  const extension = filename.split('.').pop() || '';
  const sanitizedName = filename
    .split('.')[0]
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toLowerCase();
  
  return `documents/${sanitizedName}-${uuid}.${extension}`;
}

function base64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  
  return buffer;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filename, contentType, fileData } = await req.json();
    console.log('Procesando archivo:', filename, 'tipo:', contentType);

    if (!fileData) {
      throw new Error('No se recibió contenido del archivo');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const fileUuid = crypto.randomUUID();
    const storagePath = generateSecureFilePath(filename, fileUuid);
    
    console.log('Preparando archivo para almacenamiento:', storagePath);

    const fileBuffer = base64ToUint8Array(fileData);

    const { data: storageData, error: storageError } = await supabaseAdmin.storage
      .from('cv_uploads')
      .upload(storagePath, fileBuffer, {
        contentType: contentType,
        upsert: false
      });

    if (storageError) {
      console.error('Error subiendo archivo a Storage:', storageError);
      throw storageError;
    }

    console.log('Archivo subido exitosamente:', storageData?.path);

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('cv_uploads')
      .getPublicUrl(storagePath);

    const { data: document, error: insertError } = await supabaseAdmin
      .from('documents')
      .insert({
        filename: filename,
        file_path: storagePath,
        status: 'processing',
        content_type: contentType
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    console.log('Documento creado:', document.id);

    try {
      console.log('Obteniendo access token...');
      const accessToken = await getGoogleAccessToken();
      
      console.log('Realizando OCR...');
      const extractedText = await performOCR(fileData, accessToken);
      
      console.log('Procesando texto extraído:', extractedText ? `${extractedText.substring(0, 100)}...` : 'Sin texto');
      const processedResult = await processExtractedText(extractedText);
      
      console.log('Actualizando documento con texto procesado:', {
        status: processedResult.status,
        metadata: processedResult.metadata
      });

      const { error: updateError } = await supabaseAdmin
        .from('documents')
        .update({
          processed_text: processedResult.processedText,
          status: processedResult.status,
          processed_at: new Date().toISOString(),
          processing_metadata: {
            last_update: new Date().toISOString(),
            text_quality: processedResult.metadata.quality,
            text_length: processedResult.metadata.textLength,
            processing_notes: processedResult.metadata.notes
          }
        })
        .eq('id', document.id);

      if (updateError) {
        console.error('Error al actualizar processed_text:', updateError);
        throw updateError;
      }

      console.log('processed_text actualizado exitosamente:', {
        documentId: document.id,
        status: processedResult.status,
        textLength: processedResult.metadata.textLength
      });

      return new Response(
        JSON.stringify({
          success: true,
          document: {
            id: document.id,
            filename: document.filename,
            status: 'processed',
            file_path: storagePath,
            public_url: publicUrl
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Error procesando documento:', error);
      
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'error',
          error: error.message
        })
        .eq('id', document.id);

      await supabaseAdmin.storage
        .from('cv_uploads')
        .remove([storagePath]);

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
