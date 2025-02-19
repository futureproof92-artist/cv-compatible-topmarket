
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImageAnnotatorClient } from "https://esm.sh/@google-cloud/vision@4.0.2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

async function convertPDFPageToImage(pdfBuffer: ArrayBuffer, pageNum: number): Promise<Uint8Array> {
  console.log(`Iniciando conversión de página ${pageNum} a imagen`);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const page = pdfDoc.getPages()[pageNum];
  
  const singlePagePdf = await PDFDocument.create();
  const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum]);
  singlePagePdf.addPage(copiedPage);
  
  console.log('Convirtiendo PDF a PNG...');
  const pngBytes = await singlePagePdf.saveAsBase64({ dataUri: true });
  const base64Data = pngBytes.split(',')[1];
  return Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
}

async function performOCR(imageBuffer: Uint8Array): Promise<string> {
  try {
    console.log('Iniciando OCR con Google Vision API');
    const credentials = JSON.parse(Deno.env.get("GOOGLE_CLOUD_VISION_CREDENTIALS") || "{}");
    
    if (!credentials.project_id) {
      throw new Error('Credenciales de Google Cloud Vision no válidas');
    }

    const client = new ImageAnnotatorClient({ credentials });

    const [result] = await client.textDetection({
      image: {
        content: imageBuffer,
      },
    });

    const detections = result.textAnnotations;
    if (!detections || detections.length === 0) {
      console.log('No se detectó texto en la imagen');
      return '';
    }

    console.log('Texto detectado exitosamente');
    return detections[0].description || '';
  } catch (error) {
    console.error('Error en OCR:', error);
    throw new Error(`Error en OCR: ${error.message}`);
  }
}

async function extractText(file: File): Promise<string> {
  try {
    console.log(`Iniciando extracción de texto del archivo: ${file.name} (${file.type})`);
    const buffer = await file.arrayBuffer();
    
    if (file.type === 'application/pdf') {
      console.log('Procesando PDF...');
      const pdfDoc = await PDFDocument.load(buffer);
      const pageCount = pdfDoc.getPageCount();
      console.log(`PDF tiene ${pageCount} páginas`);
      let fullText = '';
      
      for (let i = 0; i < pageCount; i++) {
        console.log(`Procesando página ${i + 1} de ${pageCount}`);
        const imageBuffer = await convertPDFPageToImage(buffer, i);
        const pageText = await performOCR(imageBuffer);
        fullText += pageText + '\n\n';
      }
      
      return fullText.trim();
    }
    
    if (file.type.includes('image/')) {
      console.log('Procesando imagen directamente con OCR');
      const imageBuffer = new Uint8Array(buffer);
      return await performOCR(imageBuffer);
    }
    
    if (file.type.includes('text/') || 
        file.type.includes('application/msword') ||
        file.type.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      console.log('Procesando documento de texto');
      return await new Response(buffer).text();
    }
    
    throw new Error(`Tipo de archivo no soportado: ${file.type}`);
  } catch (error) {
    console.error('Error extrayendo texto:', error);
    throw error;
  }
}

async function processDocumentText(supabaseAdmin: any, document: any, file: File) {
  try {
    console.log('Iniciando procesamiento de documento:', document.filename);
    
    let extractedText = await extractText(file);
    console.log(`Texto extraído (${extractedText.length} caracteres)`);
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
  console.log(`Recibida petición ${req.method}`);
  
  if (req.method === 'OPTIONS') {
    console.log('Respondiendo a OPTIONS request');
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    if (req.method !== 'POST') {
      throw new Error(`Método ${req.method} no soportado`);
    }

    console.log('Verificando body de la petición');
    if (!req.body) {
      throw new Error('Request body está vacío');
    }

    console.log('Extrayendo FormData');
    const formData = await req.formData();
    const file = formData.get('file');
    
    if (!file || !(file instanceof File)) {
      throw new Error('Archivo inválido o faltante en la petición');
    }

    console.log('Archivo recibido:', {
      name: file.name,
      type: file.type,
      size: file.size
    });

    const fileExt = (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${sanitizedName}_${crypto.randomUUID()}.${fileExt}`;

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Faltan variables de entorno requeridas');
    }

    console.log('Inicializando cliente Supabase');
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log('Insertando documento en la base de datos');
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
      throw new Error(`Error en base de datos: ${insertError.message}`);
    }

    console.log('Iniciando procesamiento asíncrono');
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
        error: error.message || 'Error inesperado',
        details: error.stack || 'No hay stack trace disponible'
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
