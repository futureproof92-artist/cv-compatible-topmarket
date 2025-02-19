
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function extractText(file: File): Promise<string> {
  try {
    console.log('Iniciando extracción de texto del archivo:', file.name);
    
    // Convertir el archivo a ArrayBuffer
    const buffer = await file.arrayBuffer();
    
    // Si es un PDF, usar una estrategia específica para PDFs
    if (file.type === 'application/pdf') {
      // Por ahora, usaremos una extracción básica del contenido
      const text = await new Response(buffer).text();
      return text.replace(/[^\x20-\x7E\n]/g, ' ').trim();
    }
    
    // Para documentos de texto y otros formatos soportados
    if (file.type.includes('text/') || 
        file.type.includes('application/msword') ||
        file.type.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      const text = await new Response(buffer).text();
      return text.trim();
    }
    
    // Para imágenes, por ahora retornamos un mensaje indicando que no se puede procesar
    if (file.type.includes('image/')) {
      return 'Contenido de imagen - procesamiento de texto no disponible';
    }
    
    throw new Error(`Tipo de archivo no soportado: ${file.type}`);
  } catch (error) {
    console.error('Error extrayendo texto:', error);
    throw new Error(`Error procesando archivo: ${error.message}`);
  }
}

async function processDocumentText(supabaseAdmin: any, document: any, file: File) {
  try {
    console.log('Iniciando procesamiento de documento:', document.filename);
    
    let extractedText = await extractText(file);
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
