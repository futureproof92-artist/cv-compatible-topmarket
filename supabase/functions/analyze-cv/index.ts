
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  try {
    const { cvText, requirements } = await req.json();
    console.log('Texto recibido en analyze-cv:', cvText ? cvText.substring(0, 100) + '...' : 'Vacío');
    console.log('Requisitos recibidos:', requirements);

    if (!cvText || cvText.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'No se proporcionó texto del CV' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!requirements || !requirements.title || requirements.skills.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Requisitos incompletos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `Analiza el siguiente CV y compáralo con los requisitos del puesto. 
Requisitos:
- Título del puesto: ${requirements.title}
- Habilidades requeridas: ${requirements.skills.join(', ')}
- Experiencia requerida: ${requirements.experience}
- Ubicación: ${requirements.location}
- Educación requerida: ${requirements.education}

CV:
${cvText}

Por favor, analiza y responde EXACTAMENTE en este formato:

Porcentaje general de coincidencia: [número del 0 al 100]
Habilidades encontradas: [lista de habilidades separadas por comas]
Habilidades faltantes: [lista de habilidades separadas por comas]
Experiencia relevante: [resumen detallado]
Adecuación al puesto: [recomendación final]`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Eres un experto en análisis de CVs y recursos humanos. Debes responder siguiendo EXACTAMENTE el formato solicitado.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error en respuesta de OpenAI:', errorText);
      throw new Error(`Error en OpenAI API: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;
    console.log('Respuesta de GPT:', content);

    const analysis = parseGPTResponse(content);
    console.log('Análisis parseado:', analysis);

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error en analyze-cv:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        match_percentage: 0,
        skills_found: [],
        skills_missing: [],
        experience_summary: 'Error en el análisis',
        recommendation: 'No se pudo completar el análisis debido a un error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function parseGPTResponse(content: string) {
  try {
    const match = content.match(/Porcentaje general de coincidencia: (\d+)/);
    const skillsMatch = content.match(/Habilidades encontradas: (.*?)(?=\n|$)/);
    const skillsMissingMatch = content.match(/Habilidades faltantes: (.*?)(?=\n|$)/);
    const experienceMatch = content.match(/Experiencia relevante: (.*?)(?=\n|$)/);
    const recommendationMatch = content.match(/Adecuación al puesto: (.*?)(?=\n|$)/);

    const analysis = {
      match_percentage: match ? parseInt(match[1], 10) : 0,
      skills_found: skillsMatch ? 
        skillsMatch[1].split(',').map(s => s.trim()).filter(s => s) : [],
      skills_missing: skillsMissingMatch ? 
        skillsMissingMatch[1].split(',').map(s => s.trim()).filter(s => s) : [],
      experience_summary: experienceMatch ? 
        experienceMatch[1].trim() : 'No se especificó experiencia',
      recommendation: recommendationMatch ? 
        recommendationMatch[1].trim() : 'No se proporcionó recomendación',
    };

    console.log('Análisis estructurado:', analysis);
    return analysis;
  } catch (error) {
    console.error('Error parseando respuesta de GPT-4:', error);
    return {
      match_percentage: 0,
      skills_found: [],
      skills_missing: [],
      experience_summary: 'No se pudo analizar la experiencia',
      recommendation: 'No recomendado debido a error en el análisis',
    };
  }
}
