
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cvText, requirements } = await req.json();
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

    const prompt = `Analiza el siguiente CV y compáralo con los requisitos del puesto. 
    Requisitos:
    - Título del puesto: ${requirements.title}
    - Habilidades requeridas: ${requirements.skills.join(', ')}
    - Experiencia requerida: ${requirements.experience}
    - Ubicación: ${requirements.location}
    - Educación requerida: ${requirements.education}

    CV:
    ${cvText}

    Por favor, analiza:
    1. Porcentaje general de coincidencia con el puesto
    2. Habilidades encontradas vs requeridas
    3. Experiencia relevante
    4. Adecuación al puesto

    Formato de respuesta en JSON:
    {
      match_percentage: número del 0 al 100,
      skills_found: array de habilidades encontradas,
      skills_missing: array de habilidades faltantes,
      experience_summary: string,
      recommendation: string
    }`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres un experto en análisis de CVs y recursos humanos.' },
          { role: 'user', content: prompt }
        ],
      }),
    });

    const data = await response.json();
    const analysis = JSON.parse(data.choices[0].message.content);

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error en analyze-cv:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
