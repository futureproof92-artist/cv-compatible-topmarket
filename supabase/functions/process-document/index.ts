
// Imports necesarios para la Edge Function
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

// Encabezados CORS con dominios específicos permitidos
const allowedOrigins = [
  'https://lovable.dev',      // Dominio principal de Lovable (cubrirá todas las rutas)
  'http://localhost:3000'     // Para desarrollo local
];

// Función para generar los encabezados CORS basados en el origen de la solicitud
const getCorsHeaders = (req) => {
  const origin = req.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
};

// Función para autenticar con Google Cloud y obtener un token de acceso
async function getGoogleAccessToken(credentials) {
  try {
    const jwtPayload = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    // Crear el JWT firmado
    const encoder = new TextEncoder();
    const header = { alg: 'RS256', typ: 'JWT' };
    
    const stringifiedHeader = JSON.stringify(header);
    const stringifiedPayload = JSON.stringify(jwtPayload);
    
    const encodedHeader = btoa(stringifiedHeader).replace(/=/g, '');
    const encodedPayload = btoa(stringifiedPayload).replace(/=/g, '');
    
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    // Importar la clave privada para firmar
    const privateKey = credentials.private_key;
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      new Uint8Array(
        atob(privateKey.replace(/-----(BEGIN|END) PRIVATE KEY-----|\n/g, ''))
          .split('')
          .map(c => c.charCodeAt(0))
      ),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      importedKey,
      encoder.encode(signatureInput)
    );
    
    const signature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer))
    ).replace(/=/g, '');
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Solicitar token de acceso
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    
    if (!tokenResponse.ok) {
      throw new Error(`Error obteniendo token: ${tokenResponse.statusText}`);
    }
    
    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    console.error('Error al obtener token de Google:', error);
    throw new Error(`Error de autenticación con Google: ${error.message}`);
  }
}

// Función para procesar un PDF con Google Vision API
async function processDocumentWithVision(base64File, filename) {
  try {
    console.log(`Iniciando procesamiento con Vision API para: ${filename}`);
    
    // Obtener credenciales de Google Cloud del entorno
    const credentialsString = Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS');
    if (!credentialsString) {
      throw new Error('Credenciales de Google Cloud no encontradas en variables de entorno');
    }
    
    const credentials = JSON.parse(credentialsString);
    const accessToken = await getGoogleAccessToken(credentials);
    
    // Preparar la solicitud para Vision API
    const visionRequest = {
      requests: [
        {
          inputConfig: {
            mimeType: 'application/pdf',
            content: base64File,
          },
          features: [
            {
              type: 'DOCUMENT_TEXT_DETECTION',
            },
          ],
          pages: [1, 2, 3, 4, 5], // Procesar hasta 5 páginas
        },
      ],
    };
    
    // Enviar solicitud a Vision API
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/files:annotate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(visionRequest),
      }
    );
    
    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Error en respuesta de Vision API:', errorText);
      throw new Error(`Error en Vision API: ${visionResponse.status} ${visionResponse.statusText}`);
    }
    
    const visionData = await visionResponse.json();
    
    // Extraer el texto de la respuesta
    let extractedText = '';
    
    if (visionData.responses && visionData.responses.length > 0) {
      for (const response of visionData.responses) {
        if (response.fullTextAnnotation && response.fullTextAnnotation.text) {
          extractedText += response.fullTextAnnotation.text + '\n';
        }
      }
    }
    
    if (!extractedText) {
      console.warn('No se pudo extraer texto del documento');
      return 'No se pudo extraer texto del documento. Es posible que el PDF esté protegido o que contenga solo imágenes.';
    }
    
    console.log(`Texto extraído exitosamente de ${filename}, longitud: ${extractedText.length} caracteres`);
    return extractedText.trim();
  } catch (error) {
    console.error('Error procesando documento con Vision API:', error);
    throw new Error(`Error procesando documento con Vision API: ${error.message}`);
  }
}

// Función principal de procesamiento de documentos
async function processDocumentText(base64File, contentType, filename) {
  console.log(`Procesando documento: ${filename}, tipo: ${contentType}`);
  
  try {
    if (contentType.includes('pdf')) {
      return await processDocumentWithVision(base64File, filename);
    } else if (contentType.includes('word') || filename.endsWith('.docx') || filename.endsWith('.doc')) {
      return 'El procesamiento de documentos Word no está completamente implementado. Por favor, convierta a PDF para mejores resultados.';
    } else if (contentType.includes('image')) {
      return await processDocumentWithVision(base64File, filename);
    } else {
      throw new Error('Formato de archivo no soportado');
    }
  } catch (error) {
    console.error(`Error procesando ${filename}:`, error);
    throw error;
  }
}

// Implementación de la función retry para reintentos en caso de fallo
async function withRetry(operation, maxRetries = 3, initialDelay = 1000) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`Intento ${attempt + 1}/${maxRetries} fallido:`, error.message);
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Manejador principal de solicitudes
Deno.serve(async (req) => {
  // Manejar solicitudes CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  console.log('Solicitud recibida en process-document');
  
  try {
    const reqData = await req.json();
    console.log('Solicitud recibida:', {
      filename: reqData.filename,
      contentType: reqData.contentType,
      dataLength: reqData.fileData ? reqData.fileData.length : 0,
      useGoogleVision: reqData.useGoogleVision || false
    });

    const { fileData, contentType, filename } = reqData;

    if (!fileData) {
      return new Response(
        JSON.stringify({ error: 'No se proporcionaron datos de archivo' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Generamos un ID único para el documento
    const documentId = crypto.randomUUID();
    console.log(`Iniciando procesamiento de texto para documento ${documentId}`);

    try {
      // Procesar el documento con reintentos
      const extractedText = await withRetry(() => 
        processDocumentText(fileData, contentType, filename)
      );
      
      console.log(`Texto procesado exitosamente para ${documentId}, longitud: ${extractedText.length}`);
      
      // Guardar el texto extraído en la base de datos
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false } }
      );

      const { data: document, error: dbError } = await supabaseClient
        .from('documents')
        .insert({
          id: documentId,
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
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      console.log('Documento guardado en base de datos con ID:', document.id);

      return new Response(
        JSON.stringify({ success: true, document }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
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
            id: documentId,
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
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
        );
      } catch (dbError) {
        console.error('Error guardando documento con error:', dbError);
        return new Response(
          JSON.stringify({ error: `Error procesando documento: ${processingError.message}` }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }
  } catch (error) {
    console.error('Error general:', error);
    console.error('Stack trace:', error.stack);
    
    return new Response(
      JSON.stringify({ error: `Error procesando documento: ${error.message}` }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
