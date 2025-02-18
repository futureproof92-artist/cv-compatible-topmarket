
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      throw new Error('No file provided');
    }

    console.log('Archivo recibido:', file.name);

    // Crear el registro del documento en la base de datos
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
    
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    );

    const { data: document, error: insertError } = await supabaseAdmin
      .from('documents')
      .insert({
        filename: file.name,
        content_type: file.type,
        status: 'processing',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error insertando documento:', insertError);
      throw insertError;
    }

    console.log('Documento creado:', document);

    // Procesar el contenido del archivo (ejemplo simplificado)
    const text = await file.text();
    console.log('Texto extraído, longitud:', text.length);

    // Actualizar el documento con el texto procesado
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
      throw updateError;
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
    console.error('Error en process-document:', error);
    return new Response(
      JSON.stringify({ error: error.message }), 
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
