
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Iniciando procesamiento de documento');
    
    // Verificar si el request es FormData
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

    // Generar un file_path único y sanitizado
    const fileExt = (file.name.split('.').pop() || '').replace(/[^a-zA-Z0-9]/g, '');
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${sanitizedName}_${crypto.randomUUID()}.${fileExt}`;
    console.log('File path generado:', filePath);

    // Crear el registro del documento en la base de datos
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Convertir el archivo a texto de manera segura
    let text;
    try {
      const buffer = await file.arrayBuffer();
      console.log('Buffer obtenido, tamaño:', buffer.byteLength);
      
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(buffer);
      console.log('Texto decodificado, longitud:', text.length);
      
      if (!text) {
        throw new Error('No text content extracted from file');
      }
    } catch (error) {
      console.error('Error procesando contenido del archivo:', error);
      throw new Error(`Error processing file content: ${error.message}`);
    }

    // Insertar documento
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

    console.log('Documento creado:', document);

    // Actualizar el documento con el texto procesado
    console.log('Actualizando documento con texto procesado...');
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({
        processed_text: text,
        status: 'processed',
        processed_at: new Date().toISOString(),
      })
      .eq('id', document.id);

    if (updateError) {
      console.error('Error actualizando documento:', updateError);
      throw new Error(`Database update error: ${updateError.message}`);
    }

    console.log('Documento procesado exitosamente');

    return new Response(
      JSON.stringify({ 
        success: true, 
        document: { 
          id: document.id,
          filename: document.filename,
          status: 'processed'
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
    console.error('Error en process-document:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

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
