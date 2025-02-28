
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

// Configuración para el sistema de reintentos
const retryConfig = {
  maxRetries: 3,            // Número máximo de reintentos
  initialDelay: 1000,       // Retraso inicial (1 segundo)
  maxDelay: 8000,           // Retraso máximo (8 segundos)
  backoffFactor: 2,         // Factor de retroceso exponencial
};

// Implementación mejorada de la función retry para reintentos en caso de fallo
async function withRetry(operation, config = retryConfig, onRetry = null) {
  let lastError;
  let attempt = 0;
  
  const logRetryAttempt = (attemptNum, error, nextDelayMs) => {
    console.warn(
      `Intento ${attemptNum}/${config.maxRetries} fallido para operación: ${error.message}. ` +
      `Próximo reintento en ${nextDelayMs}ms`
    );
    if (onRetry && typeof onRetry === 'function') {
      onRetry(attemptNum, error, nextDelayMs);
    }
  };

  while (attempt < config.maxRetries) {
    try {
      const startTime = Date.now();
      console.log(`Ejecutando operación, intento ${attempt + 1}/${config.maxRetries}`);
      
      const result = await operation();
      
      console.log(`Operación completada exitosamente en ${Date.now() - startTime}ms`);
      return result;
    } catch (error) {
      lastError = error;
      attempt++;
      
      // Registrar información detallada del error
      console.error(`Error en intento ${attempt}:`, error);
      console.error('Stack trace:', error.stack || 'No disponible');
      
      if (attempt < config.maxRetries) {
        // Aplicar retroceso exponencial con jitter para evitar tormentas de reintentos
        const baseDelay = Math.min(
          config.initialDelay * Math.pow(config.backoffFactor, attempt - 1),
          config.maxDelay
        );
        // Agregar un jitter aleatorio (±20%)
        const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.floor(baseDelay + jitter);
        
        logRetryAttempt(attempt, error, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`Se agotaron todos los reintentos (${config.maxRetries}). Último error:`, error);
      }
    }
  }
  
  throw lastError;
}

// Función para autenticar con Google Cloud y obtener un token de acceso
async function getGoogleAccessToken(credentials) {
  console.log('Iniciando autenticación con Google Cloud...');
  try {
    // Usar scopes específicos para Vision API en lugar del scope general de cloud-platform
    const jwtPayload = {
      iss: credentials.client_email,
      scope: [
        'https://www.googleapis.com/auth/cloud-vision',
        'https://www.googleapis.com/auth/cloud-platform'
      ].join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    console.log('Scopes de autenticación configurados:', jwtPayload.scope);

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
    if (!privateKey) {
      throw new Error('Clave privada no encontrada en las credenciales');
    }
    
    console.log('Importando clave privada...');
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
    
    console.log('Firmando JWT...');
    const signatureBuffer = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      importedKey,
      encoder.encode(signatureInput)
    );
    
    const signature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBuffer))
    ).replace(/=/g, '');
    
    const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
    
    // Solicitar token de acceso con logging adicional
    console.log('Solicitando token de acceso a Google OAuth...');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Error en respuesta de token:', errorText);
      throw new Error(`Error obteniendo token: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorText}`);
    }
    
    const tokenData = await tokenResponse.json();
    console.log('Token de acceso obtenido exitosamente');
    return tokenData.access_token;
  } catch (error) {
    console.error('Error al obtener token de Google:', error);
    console.error('Stack trace:', error.stack || 'No disponible');
    
    // Proporcionar más detalles sobre el error
    const errorDetails = {
      message: error.message,
      type: error.constructor.name,
      cause: error.cause ? JSON.stringify(error.cause) : 'desconocida'
    };
    
    throw new Error(`Error de autenticación con Google: ${JSON.stringify(errorDetails)}`);
  }
}

// Función para procesar un PDF con Google Vision API
async function processDocumentWithVision(base64File, filename, contentType) {
  const startTime = Date.now();
  console.log(`[Vision] Iniciando procesamiento con Vision API para: ${filename} (${contentType})`);
  
  try {
    // Verificar que el archivo no esté vacío
    if (!base64File || base64File.length === 0) {
      throw new Error('El archivo está vacío o no es válido');
    }
    
    console.log(`[Vision] Tamaño del archivo ${filename}: ${base64File.length} caracteres`);
    
    // Obtener credenciales de Google Cloud del entorno
    const credentialsString = Deno.env.get('GOOGLE_CLOUD_VISION_CREDENTIALS');
    if (!credentialsString) {
      throw new Error('Credenciales de Google Cloud no encontradas en variables de entorno');
    }
    
    let credentials;
    try {
      credentials = JSON.parse(credentialsString);
      console.log(`[Vision] Credenciales de Google Cloud cargadas para proyecto: ${credentials.project_id}`);
    } catch (parseError) {
      console.error('[Vision] Error parseando credenciales:', parseError);
      throw new Error('Error al parsear las credenciales de Google Cloud: ' + parseError.message);
    }
    
    console.log('[Vision] Obteniendo token de acceso...');
    const accessToken = await withRetry(
      () => getGoogleAccessToken(credentials),
      {
        ...retryConfig,
        maxRetries: 2, // Menos reintentos para la autenticación
      },
      (attempt, error) => {
        console.warn(`[Vision] Reintentando autenticación (${attempt}): ${error.message}`);
      }
    );
    
    // Determinar el tipo de solicitud según el tipo de contenido
    const isMimeTypePdf = contentType.includes('pdf');
    const isMimeTypeImage = contentType.includes('image');
    
    console.log(`[Vision] Preparando solicitud para ${isMimeTypePdf ? 'PDF' : (isMimeTypeImage ? 'imagen' : 'documento')}`);
    
    // Preparar la solicitud para Vision API
    const visionRequest = {
      requests: [
        {
          inputConfig: {
            mimeType: isMimeTypePdf ? 'application/pdf' : 
                      (isMimeTypeImage ? contentType : 'application/pdf'),
            content: base64File,
          },
          features: [
            {
              type: 'DOCUMENT_TEXT_DETECTION',
            },
          ],
          pages: isMimeTypePdf ? [1, 2, 3, 4, 5] : [], // Para PDFs, procesar hasta 5 páginas
        },
      ],
    };
    
    // Enviar solicitud a Vision API con reintentos
    console.log('[Vision] Enviando solicitud a Vision API...');
    const visionResponse = await withRetry(
      async () => {
        const response = await fetch(
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
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Vision] Error en respuesta de Vision API:', errorText);
          throw new Error(`Error en Vision API: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        return response.json();
      },
      undefined,
      (attempt, error) => {
        console.warn(`[Vision] Reintentando solicitud a Vision API (${attempt}): ${error.message}`);
      }
    );
    
    // Extraer el texto de la respuesta
    let extractedText = '';
    
    if (visionResponse.responses && visionResponse.responses.length > 0) {
      console.log(`[Vision] Procesando ${visionResponse.responses.length} respuestas de Vision API`);
      
      for (const response of visionResponse.responses) {
        if (response.fullTextAnnotation && response.fullTextAnnotation.text) {
          extractedText += response.fullTextAnnotation.text + '\n';
        }
      }
    }
    
    if (!extractedText) {
      console.warn('[Vision] No se pudo extraer texto del documento');
      return 'No se pudo extraer texto del documento. Es posible que el PDF esté protegido o que contenga solo imágenes.';
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`[Vision] Texto extraído exitosamente de ${filename}, longitud: ${extractedText.length} caracteres. Tiempo: ${processingTime}ms`);
    
    return extractedText.trim();
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[Vision] Error procesando documento con Vision API (${processingTime}ms):`, error);
    console.error('[Vision] Stack trace:', error.stack || 'No disponible');
    throw new Error(`Error procesando documento con Vision API: ${error.message}`);
  }
}

// Función principal de procesamiento de documentos
async function processDocumentText(base64File, contentType, filename) {
  const startTime = Date.now();
  console.log(`[Processor] Procesando documento: ${filename}, tipo: ${contentType}`);
  
  try {
    let processingMethod = 'desconocido';
    let result;
    
    if (contentType.includes('pdf')) {
      console.log(`[Processor] Procesando PDF: ${filename}`);
      processingMethod = 'pdf-vision';
      result = await processDocumentWithVision(base64File, filename, contentType);
    } else if (contentType.includes('word') || filename.endsWith('.docx') || filename.endsWith('.doc')) {
      console.log(`[Processor] Documento Word detectado: ${filename}`);
      processingMethod = 'word-message';
      result = 'El procesamiento de documentos Word no está completamente implementado. Por favor, convierta a PDF para mejores resultados.';
    } else if (contentType.includes('image')) {
      console.log(`[Processor] Procesando imagen: ${filename}`);
      processingMethod = 'image-vision';
      result = await processDocumentWithVision(base64File, filename, contentType);
    } else {
      processingMethod = 'unsupported';
      throw new Error(`Formato de archivo no soportado: ${contentType}`);
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`[Processor] Procesamiento completado para ${filename} usando método ${processingMethod}. Tiempo: ${processingTime}ms`);
    
    return result;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[Processor] Error procesando ${filename} (${processingTime}ms):`, error);
    console.error('[Processor] Stack trace:', error.stack || 'No disponible');
    throw error;
  }
}

// Manejador principal de solicitudes
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  console.log(`[${requestId}] Solicitud recibida en process-document`);
  
  // Manejar solicitudes CORS preflight
  if (req.method === 'OPTIONS') {
    console.log(`[${requestId}] Respondiendo a preflight CORS`);
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    const reqData = await req.json();
    console.log(`[${requestId}] Solicitud recibida:`, {
      filename: reqData.filename,
      contentType: reqData.contentType,
      dataLength: reqData.fileData ? reqData.fileData.length : 0,
      useGoogleVision: reqData.useGoogleVision || false
    });

    const { fileData, contentType, filename } = reqData;

    if (!fileData) {
      console.error(`[${requestId}] Error: No se proporcionaron datos de archivo`);
      return new Response(
        JSON.stringify({ error: 'No se proporcionaron datos de archivo' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Validar el tipo de contenido
    if (!contentType) {
      console.error(`[${requestId}] Error: No se proporcionó tipo de contenido`);
      return new Response(
        JSON.stringify({ error: 'No se proporcionó tipo de contenido' }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Generamos un ID único para el documento
    const documentId = crypto.randomUUID();
    console.log(`[${requestId}] Iniciando procesamiento de texto para documento ${documentId}`);

    try {
      // Crear cliente Supabase
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false } }
      );
      
      // Registrar el documento como "en procesamiento" para poder rastrear su estado
      const { data: initialDocument, error: initialError } = await supabaseClient
        .from('documents')
        .insert({
          id: documentId,
          filename,
          content_type: contentType,
          status: 'processing',
          file_path: documentId // Usamos el documentId como file_path provisional
        })
        .select()
        .single();
        
      if (initialError) {
        console.error(`[${requestId}] Error registrando documento en base de datos:`, initialError);
        return new Response(
          JSON.stringify({ error: `Error registrando documento: ${initialError.message}` }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
        );
      }
      
      console.log(`[${requestId}] Documento registrado en base de datos con ID: ${documentId}, estado: processing`);
      
      // Procesar el documento con reintentos en modo asíncrono
      // Esto permite responder rápidamente al cliente mientras continúa el procesamiento
      EdgeRuntime.waitUntil((async () => {
        try {
          // Procesar el documento con reintentos
          console.log(`[${requestId}] Iniciando procesamiento asíncrono para documento ${documentId}`);
          const extractedText = await withRetry(() => 
            processDocumentText(fileData, contentType, filename)
          );
          
          console.log(`[${requestId}] Texto procesado exitosamente para ${documentId}, longitud: ${extractedText.length}`);
          
          // Actualizar el registro con el texto extraído y estado "processed"
          const { data: updatedDocument, error: updateError } = await supabaseClient
            .from('documents')
            .update({
              processed_text: extractedText,
              status: 'processed',
              processed_at: new Date().toISOString()
            })
            .eq('id', documentId)
            .select()
            .single();
          
          if (updateError) {
            console.error(`[${requestId}] Error actualizando documento en base de datos:`, updateError);
            throw updateError;
          }
          
          console.log(`[${requestId}] Documento actualizado en base de datos: ${documentId}, estado: processed`);
        } catch (processingError) {
          console.error(`[${requestId}] Error en procesamiento asíncrono:`, processingError);
          
          // En caso de error, actualizamos el documento con estado de error
          try {
            await supabaseClient
              .from('documents')
              .update({
                status: 'error',
                error: `Error: ${processingError.message}`,
                processed_at: new Date().toISOString()
              })
              .eq('id', documentId);
              
            console.log(`[${requestId}] Documento marcado con error: ${documentId}`);
          } catch (dbError) {
            console.error(`[${requestId}] Error actualizando estado de error:`, dbError);
          }
        }
      })());
      
      // Responder inmediatamente con el ID del documento
      const responseTime = Date.now() - startTime;
      console.log(`[${requestId}] Respondiendo al cliente. Tiempo de respuesta: ${responseTime}ms`);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          document: initialDocument,
          message: "El documento está siendo procesado. Consulte su estado más tarde."
        }),
        { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    } catch (processingError) {
      console.error(`[${requestId}] Error procesando texto del documento:`, processingError);
      
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
            status: 'error',
            file_path: documentId,
            error: processingError.message
          })
          .select()
          .single();
          
        const responseTime = Date.now() - startTime;
        console.log(`[${requestId}] Respondiendo con error. Tiempo: ${responseTime}ms`);
        
        return new Response(
          JSON.stringify({ 
            error: `Error procesando documento: ${processingError.message}`,
            document: errorDocument
          }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
        );
      } catch (dbError) {
        console.error(`[${requestId}] Error guardando documento con error:`, dbError);
        return new Response(
          JSON.stringify({ error: `Error procesando documento: ${processingError.message}` }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[${requestId}] Error general (${responseTime}ms):`, error);
    console.error(`[${requestId}] Stack trace:`, error.stack || 'No disponible');
    
    return new Response(
      JSON.stringify({ error: `Error procesando documento: ${error.message}` }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
