
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
    console.log('Iniciando extracción de texto con pdf.js');
    
    // Convertir base64 a Uint8Array para pdf.js
    const uint8Array = new Uint8Array(atob(fileData).split('').map(char => char.charCodeAt(0)));
    console.log('Archivo convertido a Uint8Array, longitud:', uint8Array.length);

    // Configurar worker para pdf.js
    const workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs';
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

    // Cargar el PDF
    console.log('Cargando PDF...');
    const loadingTask = pdfjs.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;
    console.log('PDF cargado, páginas:', pdf.numPages);

    let text = '';
    // Extraer texto de cada página
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`Procesando página ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      text += pageText + ' ';
      console.log(`Página ${i}: extraídos ${pageText.length} caracteres`);
    }

    const finalText = text.trim();
    console.log('Texto total extraído:', finalText.length, 'caracteres');
    return finalText;
  } catch (error) {
    console.error('Error detallado en pdf.js:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return '';
  }
}

async function performOCR(fileData: string): Promise<string> {
  try {
    console.log('Iniciando OCR con Google Vision API');
    const credentials = Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS');
    if (!credentials) {
      throw new Error('Credenciales de Google Cloud Vision no configuradas');
    }

    const visionClient = new createVisionClient({
      credentials: JSON.parse(credentials)
    });

    console.log('Cliente Vision API inicializado');

    const request = {
      image: {
        content: fileData
      },
      features: [
        {
          type: 'DOCUMENT_TEXT_DETECTION' // Cambiado a DOCUMENT_TEXT_DETECTION para mejor precisión con documentos
        }
      ]
    };

    console.log('Enviando solicitud a Vision API...');
    const [result] = await visionClient.textDetection(request);
    console.log('Respuesta recibida de Vision API');

    if (result.fullTextAnnotation) {
      const extractedText = result.fullTextAnnotation.text;
      console.log('Texto extraído con OCR:', extractedText.length, 'caracteres');
      return extractedText;
    }

    console.log('No se encontró texto en la imagen');
    return '';
  } catch (error) {
    console.error('Error detallado en OCR:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Iniciando procesamiento de documento');
    const { filename, contentType, fileData } = await req.json();
    
    if (!fileData || !filename || !contentType) {
      throw new Error('Se requieren filename, contentType y fileData');
    }

    console.log('Tipo de archivo:', contentType);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Crear registro inicial
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

    // Procesar documento
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

    // Actualizar registro con el texto extraído
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

    // Subir archivo a Storage
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

    // Obtener URL pública
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
          ...corsHeaders, 
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
