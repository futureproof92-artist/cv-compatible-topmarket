
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.189/build/pdf.min.mjs";
import { getDocument, GlobalWorkerOptions } from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.189/build/pdf.min.mjs";

// Configuración del worker para pdfjs
GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.189/build/pdf.worker.min.mjs";

// Configuración de CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Extracción de texto usando pdfjs-dist
async function extractTextWithPdfJs(fileData: string): Promise<string> {
  try {
    console.log('Iniciando extracción de texto con pdfjs-dist');
    
    // Convertir base64 a Uint8Array
    const binaryString = atob(fileData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log('Base64 convertido a Uint8Array, cargando PDF con pdfjs-dist');
    
    // Cargar el PDF usando pdfjs-dist
    const loadingTask = getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    
    const pageCount = pdf.numPages;
    console.log(`PDF cargado correctamente. Número de páginas: ${pageCount}`);
    
    // Extraer texto de cada página
    let extractedText = '';
    
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      extractedText += pageText + '\n';
      console.log(`Página ${i}: Extracción completada`);
    }
    
    const finalText = extractedText.trim();
    console.log(`Texto extraído: ${finalText.length} caracteres`);
    
    // Si tenemos texto significativo (más de 100 caracteres)
    if (finalText.length > 100) {
      console.log('Extracción con pdfjs-dist exitosa');
      return finalText;
    }
    
    // Si no pudimos obtener suficiente texto, es mejor usar OCR
    console.log('Texto insuficiente, se usará OCR como respaldo');
    return '';
  } catch (error) {
    console.error('Error en extracción de texto con pdfjs-dist:', error);
    return '';
  }
}

async function performOCR(fileData: string): Promise<string> {
  try {
    console.log('Iniciando OCR con Google Vision API');
    const credentials = JSON.parse(Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS') || '{}');
    
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Credenciales de Google Cloud Vision incompletas o no configuradas');
    }
    
    console.log('Obteniendo token de acceso para Google Vision API');
    const accessToken = await getAccessToken(credentials);
    console.log('Token de acceso obtenido, iniciando procesamiento OCR');

    const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{
          image: { content: fileData },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Error en la respuesta de Vision API:', response.status, error);
      throw new Error(`Error en Vision API: ${error.error?.message || response.status}`);
    }

    const result = await response.json();
    const textAnnotation = result.responses[0]?.fullTextAnnotation;
    
    if (textAnnotation?.text) {
      console.log(`OCR completado, texto extraído (${textAnnotation.text.length} caracteres)`);
      return textAnnotation.text;
    }
    
    console.log('OCR completado, pero no se encontró texto');
    return '';
  } catch (error) {
    console.error('Error en OCR:', error);
    throw error;
  }
}

async function getAccessToken(credentials: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://vision.googleapis.com/',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-vision'
  };

  const key = await crypto.subtle.importKey(
    'pkcs8',
    new TextEncoder().encode(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const jwt = await create({ alg: 'RS256', typ: 'JWT' }, payload, key);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('Recibida solicitud OPTIONS (CORS preflight)');
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }
  
  try {
    console.log('Iniciando procesamiento de documento');
    
    // Extraer y validar datos de entrada
    const { filename, contentType, fileData } = await req.json();
    
    if (!fileData) {
      throw new Error('Se requiere fileData');
    }
    
    if (!filename) {
      throw new Error('Se requiere filename');
    }
    
    if (!contentType) {
      throw new Error('Se requiere contentType');
    }
    
    console.log(`Archivo recibido para procesamiento: ${filename}, tipo: ${contentType}`);

    // Inicializar cliente Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Configuración de Supabase incompleta');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Crear registro en la base de datos
    console.log('Creando registro en la base de datos');
    const filePath = `documents/${filename.toLowerCase().replace(/[^a-z0-9]/g, '_')}-${crypto.randomUUID()}.${filename.split('.').pop()}`;
    
    const { data: document, error: insertError } = await supabase
      .from('documents')
      .insert({
        filename,
        content_type: contentType,
        status: 'processing',
        file_path: filePath
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error al crear registro en la base de datos:', insertError);
      throw insertError;
    }
    
    console.log(`Registro creado en base de datos, ID: ${document.id}`);

    let extractedText = '';
    
    // Estrategia en capas para extracción de texto
    if (contentType.includes('pdf') || contentType === 'application/pdf') {
      console.log('Iniciando estrategia de procesamiento para PDF');
      
      // Usar pdfjs-dist para extraer texto
      extractedText = await extractTextWithPdfJs(fileData);
      
      // Si no hay suficiente texto, usar OCR como respaldo
      if (!extractedText || extractedText.length < 100) {
        console.log('Extracción con pdfjs-dist no efectiva, cambiando a OCR como respaldo');
        extractedText = await performOCR(fileData);
      } else {
        console.log('Extracción con pdfjs-dist exitosa, no se requiere OCR');
      }
    } else {
      // Para otros formatos (imágenes), usar OCR directamente
      console.log('Documento no es PDF, procesando directamente con OCR');
      extractedText = await performOCR(fileData);
    }
    
    // Procesar resultado
    console.log('Procesamiento de texto completado');
    
    const finalText = extractedText.trim() || 'No se pudo extraer texto';
    
    // Actualizar registro en la base de datos
    console.log('Actualizando registro con texto extraído');
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        processed_text: finalText,
        status: 'processed',
        processed_at: new Date().toISOString()
      })
      .eq('id', document.id);

    if (updateError) {
      console.error('Error al actualizar registro:', updateError);
      throw updateError;
    }
    
    // Subir archivo a Storage
    console.log('Subiendo archivo a Storage');
    const fileBytes = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
    
    const { error: storageError } = await supabase.storage
      .from('cv_uploads')
      .upload(filePath, fileBytes, {
        contentType,
        upsert: false
      });

    if (storageError) {
      console.error('Error al subir archivo a Storage:', storageError);
      throw storageError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('cv_uploads')
      .getPublicUrl(filePath);
      
    console.log('Procesamiento completado exitosamente');
    
    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          filename: document.filename,
          status: 'processed',
          file_path: filePath,
          public_url: publicUrl,
          extracted_text: finalText
        }
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Error en process-document:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Error procesando documento', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function create(header: { alg: string, typ: string }, payload: any, key: CryptoKey) {
  const encoder = new TextEncoder();
  
  const headerStr = JSON.stringify(header);
  const encodedHeader = btoa(headerStr)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  const payloadStr = JSON.stringify(payload);
  const encodedPayload = btoa(payloadStr)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  const signatureInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  
  const signatureBuffer = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signatureInput
  );
  
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
