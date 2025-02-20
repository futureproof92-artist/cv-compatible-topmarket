
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImageAnnotatorClient } from "https://esm.sh/@google-cloud/vision@4.0.2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Temporalmente más permisivo para diagnóstico
  'Access-Control-Allow-Methods': '*', // Permitir todos los métodos temporalmente
  'Access-Control-Allow-Headers': '*', // Permitir todos los headers temporalmente
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
};

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

async function initializeVisionClient() {
  try {
    const credentialsString = Deno.env.get("GOOGLE_CLOUD_VISION_CREDENTIALS");
    if (!credentialsString) {
      throw new Error('No se encontraron las credenciales de Google Cloud Vision');
    }

    log.info('Intentando parsear credenciales de Google Cloud Vision');
    const credentials = JSON.parse(credentialsString);
    
    if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
      throw new Error('Credenciales incompletas. Se requiere project_id, private_key y client_email');
    }

    log.info('Inicializando cliente de Vision API', { project_id: credentials.project_id });
    return new ImageAnnotatorClient({ credentials });
  } catch (error) {
    log.error('Error inicializando Vision Client', error);
    throw error;
  }
}

async function convertPDFPageToImage(pdfBuffer: ArrayBuffer, pageNum: number): Promise<Uint8Array> {
  log.info(`Iniciando conversión de página ${pageNum} a imagen`);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const page = pdfDoc.getPages()[pageNum];
  
  const singlePagePdf = await PDFDocument.create();
  const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [pageNum]);
  singlePagePdf.addPage(copiedPage);
  
  log.info('Convirtiendo PDF a PNG...');
  const pngBytes = await singlePagePdf.saveAsBase64({ dataUri: true });
  const base64Data = pngBytes.split(',')[1];
  return Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
}

async function performOCR(imageBuffer: Uint8Array): Promise<string> {
  try {
    log.info('Iniciando OCR con Google Vision API');
    const client = await initializeVisionClient();

    const [result] = await client.textDetection({
      image: {
        content: imageBuffer,
      },
    });

    const detections = result.textAnnotations;
    if (!detections || detections.length === 0) {
      log.info('No se detectó texto en la imagen');
      return '';
    }

    log.info('Texto detectado exitosamente');
    return detections[0].description || '';
  } catch (error) {
    log.error('Error en OCR:', error);
    throw new Error(`Error en OCR: ${error.message}`);
  }
}

async function extractText(file: File): Promise<string> {
  try {
    log.info(`Iniciando extracción de texto del archivo: ${file.name} (${file.type})`);
    const buffer = await file.arrayBuffer();
    
    if (file.type === 'application/pdf') {
      log.info('Procesando PDF...');
      const pdfDoc = await PDFDocument.load(buffer);
      const pageCount = pdfDoc.getPageCount();
      log.info(`PDF tiene ${pageCount} páginas`);
      let fullText = '';
      
      for (let i = 0; i < pageCount; i++) {
        log.info(`Procesando página ${i + 1} de ${pageCount}`);
        const imageBuffer = await convertPDFPageToImage(buffer, i);
        const pageText = await performOCR(imageBuffer);
        fullText += pageText + '\n\n';
      }
      
      return fullText.trim();
    }
    
    if (file.type.includes('image/')) {
      log.info('Procesando imagen directamente con OCR');
      const imageBuffer = new Uint8Array(buffer);
      return await performOCR(imageBuffer);
    }
    
    if (file.type.includes('text/') || 
        file.type.includes('application/msword') ||
        file.type.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      log.info('Procesando documento de texto');
      return await new Response(buffer).text();
    }
    
    throw new Error(`Tipo de archivo no soportado: ${file.type}`);
  } catch (error) {
    log.error('Error extrayendo texto:', error);
    throw error;
  }
}

async function processDocumentText(supabaseAdmin: any, document: any, file: File) {
  try {
    log.info('Iniciando procesamiento de documento:', document.filename);
    
    let extractedText = await extractText(file);
    log.info(`Texto extraído (${extractedText.length} caracteres)`);
    log.info('Muestra del texto:', extractedText.substring(0, 200));
    
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

    log.info('Documento procesado exitosamente:', document.id);
  } catch (error) {
    log.error('Error procesando documento:', error);
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
  // Logging mejorado para cada petición
  log.info(`Nueva petición recibida - Método: ${req.method}`, {
    headers: Object.fromEntries(req.headers.entries()),
    url: req.url,
    origin: req.headers.get('origin') || 'no origin'
  });

  // Manejo mejorado de OPTIONS para CORS
  if (req.method === 'OPTIONS') {
    log.info('Procesando petición OPTIONS (CORS preflight)', {
      requestHeaders: Object.fromEntries(req.headers.entries())
    });
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Content-Length': '0',
        'Content-Type': 'text/plain',
        'Vary': 'Origin'
      }
    });
  }

  try {
    if (req.method !== 'POST') {
      throw new Error(`Método ${req.method} no soportado`);
    }

    log.info('Verificando contenido de la petición');
    if (!req.body) {
      throw new Error('Request body está vacío');
    }

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

    const fileExt = (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${sanitizedName}_${crypto.randomUUID()}.${fileExt}`;

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Faltan variables de entorno requeridas');
    }

    log.info('Inicializando cliente Supabase');
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    const responseData = {
      success: true,
      document: {
        id: document.id,
        filename: document.filename,
        status: 'processing'
      }
    };

    log.info('Enviando respuesta exitosa', responseData);
    
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Vary': 'Origin'
      }
    });
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
          'Content-Type': 'application/json',
          'Vary': 'Origin'
        }
      }
    );
  }
});
