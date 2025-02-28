
import { createClient } from '@supabase/supabase-js';
import { pdfjsLib } from './pdf.js';
// Corregir la importación de mammoth con una URL específica de Deno
import * as mammoth from 'https://deno.land/x/mammoth@1.6.0/mod.ts';

// Configurar GlobalWorkerOptions al inicio para evitar errores
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        console.log('Creando objeto loadingTask...');
        // Configurar el objeto de carga con opciones específicas para entornos serverless
        const loadingTask = pdfjsLib.getDocument({
          data: bytes,
          disableWorker: true,        // Desactiva worker
          useWorkerFetch: false,      // En algunos casos, también evita fetch interno
          isEvalSupported: false      // Puede ayudar en entornos serverless
        });

        console.log('Cargando documento PDF...');
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

        extractedText = textContent;
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
      console.log('Procesando imagen... [Placeholder para integración OCR]');
      // Aquí iría la integración con OCR si se decide implementar
      extractedText = 'Contenido de imagen (se necesita implementar OCR)';
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
