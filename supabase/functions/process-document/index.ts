
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImageAnnotatorClient } from "https://esm.sh/@google-cloud/vision@4.0.2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

// Configuración de CORS mejorada
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://cv-compatible-topmarket.lovable.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, origin',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true',
};

// Función para logging consistente
const log = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: any) => {
    console.error(`[ERROR] ${message}`, {
      message: error.message,
      stack: error.stack,
      cause: error.cause
    });
  }
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
  log.info(`Recibida petición ${req.method}`);

  // Manejo específico del preflight request
  if (req.method === 'OPTIONS') {
    log.info('Procesando OPTIONS request (CORS preflight)');
    return new Response(null, {
      status: 204, // No Content
      headers: {
        ...corsHeaders,
        'Content-Length': '0',
        'Content-Type': 'text/plain'
      }
    });
  }

  try {
    // Validación del método HTTP
    if (req.method !== 'POST') {
      throw new Error(`Método ${req.method} no soportado`);
    }

    log.info('Verificando contenido de la petición');
    if (!req.body) {
      throw new Error('Request body está vacío');
    }

    // Procesamiento del FormData
    const formData = await req.formData();
    const file = formData.get('file');
    
    if (!file || !(file instanceof File)) {
      throw new Error('Archivo inválido o faltante en la petición');
    }

    log.info('Archivo recibido', {
      nombre: file.name,
      tipo: file.type,
      tamaño: file.size
    });

    // Procesamiento del nombre del archivo
    const fileExt = (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${sanitizedName}_${crypto.randomUUID()}.${fileExt}`;

    // Validación de variables de entorno
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Faltan variables de entorno requeridas');
    }

    log.info('Inicializando cliente Supabase');
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Inserción en base de datos
    log.info('Insertando documento en base de datos');
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
      log.error('Error en inserción de documento', insertError);
      throw new Error(`Error en base de datos: ${insertError.message}`);
    }

    log.info('Iniciando procesamiento asíncrono', { documentId: document.id });
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
        status: 200,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        } 
      }
    );
  } catch (error) {
    log.error('Error en process-document', error);
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
