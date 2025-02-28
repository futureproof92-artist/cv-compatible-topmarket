
// Actualizar la importación de supabase-js con una URL específica
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
// Actualizar la importación de PDF.js con URL específica
import pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.189/build/pdf.min.mjs";
// Corregir la importación de mammoth con una URL específica de Deno
import * as mammoth from 'https://deno.land/x/mammoth@1.6.0/mod.ts';

// Configurar GlobalWorkerOptions al inicio para evitar errores
pdfjsLib.GlobalWorkerOptions.workerSrc = "";
pdfjsLib.GlobalWorkerOptions.workerPort = null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Función para extraer texto de PDF
async function extractTextFromPdf(pdfBytes: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false
  });
  
  const pdfDocument = await loadingTask.promise;
  console.log(`PDF cargado: ${pdfDocument.numPages} páginas`);
  
  // Extraer texto de cada página
  let textContent = '';
  for (let i = 1; i <= pdfDocument.numPages; i++) {
    console.log(`Procesando página ${i}...`);
    const page = await pdfDocument.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    textContent += pageText + '\n';
  }
  
  return textContent;
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

    // Procesar el archivo según su tipo
    let extractedText = '';
    if (contentType.includes('pdf')) {
      console.log('Procesando PDF...');
      try {
        extractedText = await extractTextFromPdf(bytes);
        console.log('Texto extraído del PDF exitosamente');
      } catch (error) {
        console.error('Error procesando PDF:', error);
        console.error('Stack trace:', error.stack);
        return new Response(
          JSON.stringify({ error: `Error procesando PDF: ${error.message}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    } else if (contentType.includes('word') || 
               filename.endsWith('.docx') || 
               filename.endsWith('.doc')) {
      console.log('Procesando documento Word...');
      try {
        const result = await mammoth.extractRawText({ arrayBuffer: bytes });
        extractedText = result.value;
        console.log('Texto extraído del documento Word exitosamente');
      } catch (error) {
        console.error('Error procesando documento Word:', error);
        return new Response(
          JSON.stringify({ error: `Error procesando documento Word: ${error.message}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    } else if (contentType.includes('image')) {
      console.log('Procesando imagen...');
      try {
        console.log('Iniciando extracción de texto de imagen con Vision API...');
        // Aquí se implementaría la lógica OCR
        extractedText = 'Contenido de imagen (procesamiento OCR no implementado)';
      } catch (error) {
        console.error('Error procesando imagen:', error);
        return new Response(
          JSON.stringify({ error: `Error procesando imagen: ${error.message}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Tipo de archivo no soportado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

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
    
  } catch (error) {
    console.error('Error general:', error);
    console.error('Stack trace:', error.stack);
    
    return new Response(
      JSON.stringify({ error: `Error procesando documento: ${error.message}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
