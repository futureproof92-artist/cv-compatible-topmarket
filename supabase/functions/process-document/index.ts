
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjs from 'https://cdn.skypack.dev/pdfjs-dist@3.11.174/build/pdf.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function extractTextFromPDF(pdfBytes: Uint8Array): Promise<string> {
  try {
    console.log('Iniciando extracción de texto del PDF');
    
    // Configurar worker para pdfjs
    const pdfjsWorker = 'https://cdn.skypack.dev/pdfjs-dist@3.11.174/build/pdf.worker.js';
    pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    
    // Cargar el documento
    const loadingTask = pdfjs.getDocument({ data: pdfBytes });
    const pdf = await loadingTask.promise;
    console.log('PDF cargado, número de páginas:', pdf.numPages);
    
    let fullText = '';
    
    // Extraer texto de cada página
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log('Procesando página', i);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    console.log('Extracción de texto completada, longitud:', fullText.length);
    return fullText.trim();
  } catch (error) {
    console.error('Error extrayendo texto del PDF:', error);
    throw new Error('Error al procesar el PDF: ' + error.message);
  }
}

async function processDocumentText(supabaseAdmin: any, document: any, file: File) {
  try {
    console.log('Iniciando procesamiento de documento:', document.filename);
    const buffer = await file.arrayBuffer();
    console.log('Buffer obtenido, tamaño:', buffer.byteLength);
    
    let extractedText = '';
    
    if (file.type === 'application/pdf') {
      extractedText = await extractTextFromPDF(new Uint8Array(buffer));
    } else {
      // Para otros tipos de archivo, intentamos decodificación simple
      const decoder = new TextDecoder('utf-8', { fatal: false });
      extractedText = decoder.decode(buffer);
    }
    
    console.log('Texto extraído, longitud:', extractedText.length);
    console.log('Muestra del texto:', extractedText.substring(0, 200));
    
    if (!extractedText) {
      throw new Error('No se pudo extraer texto del documento');
    }

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

    console.log('Documento procesado exitosamente:', document.id);
  } catch (error) {
    console.error('Error procesando documento:', error);
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'error',
        error: error.message,
      })
      .eq('id', document.id);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Iniciando procesamiento de documento');
    
    if (!req.body) {
      throw new Error('Request body is empty');
    }

    const formData = await req.formData();
    const file = formData.get('file');
    
    if (!file || !(file instanceof File)) {
      throw new Error('Invalid or missing file in request');
    }

    console.log('Archivo recibido:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    const fileExt = (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${sanitizedName}_${crypto.randomUUID()}.${fileExt}`;
    console.log('File path generado:', filePath);

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('Insertando documento en la base de datos...');
    const { data: document, error: insertError } = await supabaseAdmin
      .from('documents')
      .insert({
        filename: sanitizedName,
        file_path: filePath,
        content_type: file.type,
        status: 'processing',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error insertando documento:', insertError);
      throw new Error(`Database insert error: ${insertError.message}`);
    }

    EdgeRuntime.waitUntil(processDocumentText(supabaseAdmin, document, file));

    return new Response(
      JSON.stringify({ 
        success: true, 
        document: { 
          id: document.id,
          filename: document.filename,
          status: 'processing'
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
        error: error.message || 'An unexpected error occurred',
        details: error.stack || 'No stack trace available'
      }), 
      { 
        status: 500,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
  }
});
