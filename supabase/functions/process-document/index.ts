
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.min.mjs";
import { create, verify } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const ALLOWED_ORIGINS = {
  production: 'https://cv-compatible-topmarket.lovable.app',
  development: 'http://localhost:8080'
};

const getOrigin = () => {
  const isProd = Deno.env.get('ENVIRONMENT') === 'production';
  return isProd ? ALLOWED_ORIGINS.production : ALLOWED_ORIGINS.development;
};

const corsHeaders = (requestOrigin?: string) => {
  const allowedOrigin = getOrigin();
  
  const origin = requestOrigin && (
    requestOrigin === ALLOWED_ORIGINS.production || 
    requestOrigin === ALLOWED_ORIGINS.development
  ) ? requestOrigin : allowedOrigin;

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true'
  };
};

async function extractTextWithPdfJs(fileData: string): Promise<string> {
  try {
    console.log('Iniciando extracción de texto con pdf.js');
    
    const uint8Array = new Uint8Array(atob(fileData).split('').map(char => char.charCodeAt(0)));
    console.log('Archivo convertido a Uint8Array, longitud:', uint8Array.length);

    const workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs';
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

    console.log('Cargando PDF...');
    const loadingTask = pdfjs.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;
    console.log('PDF cargado, páginas:', pdf.numPages);

    let text = '';
    let hasExtractableText = false;

    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`Procesando página ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      
      if (pageText.trim().length > 0) {
        hasExtractableText = true;
      }
      
      text += pageText + ' ';
      console.log(`Página ${i}: extraídos ${pageText.length} caracteres`);
    }

    const finalText = text.trim();
    console.log('Texto total extraído:', finalText.length, 'caracteres');
    
    if (!hasExtractableText || finalText.length < 50) {
      console.log('Texto extraído insuficiente, se procederá con OCR');
      return '';
    }
    
    return finalText;
  } catch (error) {
    console.error('Error detallado en pdf.js:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return '';
  }
}

// Función para generar un token JWT para autenticación con Google Cloud
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

async function performOCR(fileData: string, retryCount = 0): Promise<string> {
  try {
    console.log('Iniciando OCR con Google Vision API REST');
    const credentials = JSON.parse(Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS') || '{}');
    const accessToken = await getAccessToken(credentials);

    const maxBytes = 10485760; // 10MB
    const segments = [];
    let start = 0;
    
    while (start < fileData.length) {
      segments.push(fileData.slice(start, start + maxBytes));
      start += maxBytes;
    }

    console.log(`Documento dividido en ${segments.length} segmentos para OCR`);
    let fullText = '';

    for (let i = 0; i < segments.length; i++) {
      console.log(`Procesando segmento ${i + 1}/${segments.length}`);
      
      const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          requests: [{
            image: { content: segments[i] },
            features: [{ 
              type: 'DOCUMENT_TEXT_DETECTION',
              maxResults: 1
            }]
          }]
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Error en la respuesta de Vision API:', error);
        
        // Retry con backoff exponencial si es un error temporal
        if (retryCount < 3 && (response.status === 429 || response.status >= 500)) {
          const delay = Math.pow(2, retryCount) * 1000;
          console.log(`Reintentando en ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return performOCR(fileData, retryCount + 1);
        }
        
        throw new Error(`Error en Vision API: ${error.error?.message || 'Unknown error'}`);
      }

      const result = await response.json();
      const textAnnotation = result.responses[0]?.fullTextAnnotation;
      
      if (textAnnotation?.text) {
        fullText += textAnnotation.text + ' ';
        console.log(`Texto extraído del segmento ${i + 1}:`, textAnnotation.text.length, 'caracteres');
      }
    }

    const extractedText = fullText.trim();
    if (!extractedText) {
      console.log('No se encontró texto en la imagen');
      return '';
    }

    console.log('OCR completado exitosamente. Total caracteres:', extractedText.length);
    return extractedText;
  } catch (error) {
    console.error('Error detallado en OCR:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
      console.error('Mensaje de error:', error.message);
    }
    throw error;
  }
}

serve(async (req) => {
  const requestOrigin = req.headers.get('origin');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      headers: corsHeaders(requestOrigin)
    });
  }

  try {
    console.log('Iniciando procesamiento de documento');
    console.log('Origen de la solicitud:', requestOrigin);
    
    const { filename, contentType, fileData } = await req.json();
    
    if (!fileData || !filename || !contentType) {
      throw new Error('Se requieren filename, contentType y fileData');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Creando registro en la base de datos...');
    const { data: document, error: insertError } = await supabaseClient
      .from('documents')
      .insert({
        filename,
        content_type: contentType,
        status: 'processing',
        file_path: `documents/${filename.toLowerCase().replace(/[^a-z0-9]/g, '_')}-${crypto.randomUUID()}.${filename.split('.').pop()}`
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error al crear registro:', insertError);
      throw insertError;
    }

    let extractedText = '';
    
    if (contentType === 'application/pdf') {
      console.log('Procesando PDF...');
      extractedText = await extractTextWithPdfJs(fileData);
      
      if (!extractedText) {
        console.log('No se extrajo texto con pdf.js, intentando OCR...');
        extractedText = await performOCR(fileData);
      }
    } else {
      console.log('Procesando imagen directamente con OCR...');
      extractedText = await performOCR(fileData);
    }

    console.log('Actualizando registro con texto extraído...');
    const finalText = extractedText.trim() || 'No se pudo extraer texto';
    const { error: updateError } = await supabaseClient
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

    console.log('Subiendo archivo a Storage...');
    const { error: storageError } = await supabaseClient.storage
      .from('cv_uploads')
      .upload(document.file_path, Uint8Array.from(atob(fileData), c => c.charCodeAt(0)), {
        contentType,
        upsert: false
      });

    if (storageError) {
      console.error('Error al subir archivo:', storageError);
      throw storageError;
    }

    const { data: { publicUrl } } = supabaseClient.storage
      .from('cv_uploads')
      .getPublicUrl(document.file_path);

    console.log('Procesamiento completado exitosamente');
    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          filename: document.filename,
          status: 'processed',
          file_path: document.file_path,
          public_url: publicUrl,
          extracted_text: finalText
        }
      }),
      { 
        headers: { 
          ...corsHeaders(requestOrigin), 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Error en process-document:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Error procesando documento', 
        details: error instanceof Error ? error.message : 'Error desconocido'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders(requestOrigin), 'Content-Type': 'application/json' }
      }
    );
  }
});
