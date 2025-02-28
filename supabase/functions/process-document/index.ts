
// Actualizar la importación de supabase-js con una URL específica
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Función para procesar texto de documentos (con una estrategia alternativa para PDFs)
async function processDocumentText(bytes: Uint8Array, contentType: string, filename: string, clientProcessedText?: string) {
  console.log(`Procesando documento: ${filename}, tipo: ${contentType}`);
  
  // Si recibimos texto procesado por el cliente para un PDF, lo usamos directamente
  if (contentType.includes('pdf') && clientProcessedText) {
    console.log('Utilizando texto de PDF procesado por el cliente');
    return clientProcessedText;
  }
  
  // Para otros casos, devolvemos un mensaje indicando limitaciones
  if (contentType.includes('pdf')) {
    return 'Este PDF fue procesado sin extraer texto completo debido a limitaciones técnicas. Por favor, considere copiar y pegar el texto relevante manualmente si es necesario.';
  } else if (contentType.includes('word') || filename.endsWith('.docx') || filename.endsWith('.doc')) {
    return 'El procesamiento de documentos Word no está disponible. Por favor, convierta a PDF y cópielo manualmente.';
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
      dataLength: reqData.fileData ? reqData.fileData.length : 0,
      hasClientProcessedText: reqData.clientProcessedText ? true : false
    });

    const { fileData, contentType, filename, clientProcessedText } = reqData;

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
      // Procesar el documento utilizando el texto procesado por el cliente si está disponible
      const extractedText = await processDocumentText(bytes, contentType, filename, clientProcessedText);
      console.log('Texto procesado exitosamente, longitud:', extractedText.length);
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
