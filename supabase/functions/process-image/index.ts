
import { createClient } from 'https://esm.sh/@google-cloud/vision@4.0.2';
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
    const { image, filename } = await req.json();
    
    if (!image || !filename) {
      return new Response(
        JSON.stringify({ error: 'Se requiere imagen y nombre de archivo' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Obtener las credenciales de Google Cloud Vision desde las variables de entorno
    const credentials = Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS');
    if (!credentials) {
      return new Response(
        JSON.stringify({ error: 'Credenciales de Google Cloud Vision no configuradas' }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Crear cliente de Vision API
    const client = new createClient({
      credentials: JSON.parse(credentials)
    });

    // Preparar la solicitud
    const request = {
      image: {
        content: image
      },
      features: [
        {
          type: 'TEXT_DETECTION'
        }
      ]
    };

    // Realizar la detección de texto
    const [result] = await client.textDetection(request);
    const detections = result.textAnnotations;

    if (detections && detections.length > 0) {
      return new Response(
        JSON.stringify({
          text: detections[0].description,
          locale: detections[0].locale
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ text: null }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Error procesando imagen' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
