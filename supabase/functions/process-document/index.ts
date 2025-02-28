
// Actualizar la importación de supabase-js con una URL específica
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
// Importar pdfjsLib correctamente con las exportaciones nombradas
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.189/build/pdf.min.mjs";

// Configuración completa para PDF.js en entorno sin trabajadores
// Deshabilitamos explícitamente todas las características relacionadas con Workers
pdfjsLib.GlobalWorkerOptions.workerSrc = '';
const DISABLE_WORKER_OPTIONS = {
  disableWorker: true,
  disableFontFace: true,
  nativeImageDecoderSupport: 'none',
  isEvalSupported: false,
  useSystemFonts: false,
  cMapUrl: null,
  standardFontDataUrl: null
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Función mejorada para extraer texto de PDF con manejo de errores
async function extractTextFromPdf(pdfBytes: Uint8Array) {
  try {
    console.log('Configurando documento PDF con opciones:', DISABLE_WORKER_OPTIONS);
    
    // Usar opciones explícitas para deshabilitar workers
    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
      ...DISABLE_WORKER_OPTIONS
    });
    
    console.log('Tarea de carga creada, esperando promesa...');
    const pdfDocument = await loadingTask.promise;
    console.log(`PDF cargado: ${pdfDocument.numPages} páginas`);
    
    // Extraer texto de cada página con manejo de errores
    let textContent = '';
    for (let i = 1; i <= pdfDocument.numPages; i++) {
      try {
        console.log(`Procesando página ${i}...`);
        const page = await pdfDocument.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: any) => item.str)
          .join(' ');
        textContent += pageText + '\n';
      } catch (pageError) {
        console.error(`Error procesando página ${i}:`, pageError);
        textContent += `[Error en página ${i}]\n`;
      }
    }
    
    if (!textContent.trim()) {
      throw new Error('No se pudo extraer texto del documento');
    }
    
    return textContent;
  } catch (error) {
    console.error('Error en extractTextFromPdf:', error);
    throw error;
  }
}

// Función para procesar el texto del documento
async function processDocumentText(bytes: Uint8Array, contentType: string, filename: string) {
  console.log(`Procesando documento: ${filename}, tipo: ${contentType}`);
  
  if (contentType.includes('pdf')) {
    console.log('Detectado formato PDF');
    return await extractTextFromPdf(bytes);
  } else if (contentType.includes('word') || filename.endsWith('.docx') || filename.endsWith('.doc')) {
    return 'El procesamiento de documentos Word no está disponible. Por favor, convierta a PDF.';
  } else if (contentType.includes('image')) {
    return 'El procesamiento OCR de imágenes no está disponible actualmente.';
  } else {
    throw new Error('Formato de archivo no soportado');
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const reqData = await req.json();
    console.log('Solicitud recibida:', {
      filename: reqData.filename,
      contentType: reqData.contentType,
      dataLength: reqData.fileData ? reqData.fileData.length : 0
    });

    const { fileData, contentType, filename } = reqData;

    if (!fileData) {
      return new Response(
        JSON.stringify({ error: 'No se proporcionaron datos de archivo' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Decodificar el base64 a un array de bytes
    const bytes = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
    console.log(`Archivo decodificado: ${bytes.length} bytes`);

    try {
      // Procesar el documento utilizando nuestra función mejorada
      const extractedText = await processDocumentText(bytes, contentType, filename);
      console.log('Texto extraído exitosamente, longitud:', extractedText.length);
      console.log('Primeros 100 caracteres del texto:', extractedText.substring(0, 100));

      // Guardar el texto extraído en la base de datos
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false } }
      );

      const { data: document, error: dbError } = await supabaseClient
        .from('documents')
        .insert({
          filename,
          content_type: contentType,
          processed_text: extractedText,
          status: 'processed'
        })
        .select()
        .single();

      if (dbError) {
        console.error('Error guardando en base de datos:', dbError);
        return new Response(
          JSON.stringify({ error: `Error guardando en base de datos: ${dbError.message}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      console.log('Documento guardado en base de datos con ID:', document.id);

      return new Response(
        JSON.stringify({ success: true, document }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (processingError) {
      console.error('Error procesando texto del documento:', processingError);
      
      // En caso de error, registramos un documento con estado de error
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false } }
      );
      
      // Intentar guardar el documento con estado de error
      try {
        const { data: errorDocument } = await supabaseClient
          .from('documents')
          .insert({
            filename,
            content_type: contentType,
            processed_text: `Error: ${processingError.message}`,
            status: 'error'
          })
          .select()
          .single();
          
        return new Response(
          JSON.stringify({ 
            error: `Error procesando documento: ${processingError.message}`,
            document: errorDocument
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      } catch (dbError) {
        return new Response(
          JSON.stringify({ error: `Error procesando documento: ${processingError.message}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }
  } catch (error) {
    console.error('Error general:', error);
    console.error('Stack trace:', error.stack);
    
    return new Response(
      JSON.stringify({ error: `Error procesando documento: ${error.message}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
