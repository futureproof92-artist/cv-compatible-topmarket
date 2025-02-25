
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.min.mjs";
import { createClient as createVisionClient } from 'https://esm.sh/@google-cloud/vision@4.0.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function extractTextWithPdfJs(fileData: string): Promise<string> {
  try {
    const uint8Array = new Uint8Array(atob(fileData).split('').map(char => char.charCodeAt(0)));
    const loadingTask = pdfjs.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;
    let text = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(' ');
    }

    return text.trim();
  } catch (error) {
    console.error('Error extrayendo texto con pdf.js:', error);
    return '';
  }
}

async function performOCR(fileData: string, contentType: string): Promise<string> {
  try {
    const credentials = Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS');
    if (!credentials) {
      throw new Error('Credenciales de Google Cloud Vision no configuradas');
    }

    const visionClient = new createVisionClient({
      credentials: JSON.parse(credentials)
    });

    const request = {
      image: {
        content: fileData
      },
      features: [
        {
          type: 'TEXT_DETECTION'
        }
      ]
    };

    const [result] = await visionClient.textDetection(request);
    const detections = result.textAnnotations;

    if (detections && detections.length > 0) {
      return detections[0].description || '';
    }

    return '';
  } catch (error) {
    console.error('Error en OCR:', error);
    return '';
  }
}

async function processDocument(supabaseClient: any, fileData: string, filename: string, contentType: string, documentId: string) {
  try {
    console.log(`Procesando documento ${filename} (${contentType})`);

    let extractedText = '';

    if (contentType === 'application/pdf') {
      console.log('Intentando extraer texto con pdf.js...');
      extractedText = await extractTextWithPdfJs(fileData);
    }

    if (!extractedText) {
      console.log('No se extrajo texto con pdf.js o no es PDF, intentando OCR...');
      extractedText = await performOCR(fileData, contentType);
    }

    const finalText = extractedText.trim() || 'No se pudo extraer texto';
    console.log(`Texto extraído (${finalText.length} caracteres)`);

    const { error: updateError } = await supabaseClient
      .from('documents')
      .update({
        processed_text: finalText,
        status: 'processed',
        processed_at: new Date().toISOString()
      })
      .eq('id', documentId);

    if (updateError) {
      throw updateError;
    }

    return finalText;
  } catch (error) {
    console.error('Error procesando documento:', error);
    
    await supabaseClient
      .from('documents')
      .update({
        processed_text: 'Error al procesar el documento',
        status: 'error',
        processed_at: new Date().toISOString(),
        error: error.message
      })
      .eq('id', documentId);

    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filename, contentType, fileData } = await req.json();
    
    if (!fileData || !filename || !contentType) {
      throw new Error('Se requieren filename, contentType y fileData');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Crear registro inicial en la tabla documents
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

    if (insertError) throw insertError;

    // Subir archivo a Storage
    const { data: storageData, error: storageError } = await supabaseClient.storage
      .from('cv_uploads')
      .upload(document.file_path, Uint8Array.from(atob(fileData), c => c.charCodeAt(0)), {
        contentType,
        upsert: false
      });

    if (storageError) throw storageError;

    // Obtener URL pública
    const { data: { publicUrl } } = supabaseClient.storage
      .from('cv_uploads')
      .getPublicUrl(document.file_path);

    // Procesar el documento
    await processDocument(supabaseClient, fileData, filename, contentType, document.id);

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: document.id,
          filename: document.filename,
          status: 'processed',
          file_path: document.file_path,
          public_url: publicUrl
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error en process-document:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Error procesando documento', 
        details: error.message
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
