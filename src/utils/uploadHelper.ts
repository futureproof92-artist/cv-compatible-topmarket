
import { supabase } from "@/integrations/supabase/client";

interface UploadResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export async function uploadFileWithAuth(
  file: File,
  endpoint: string
): Promise<UploadResponse> {
  try {
    console.log('Iniciando proceso de subida para:', file.name);

    // Obtener sesión de Supabase
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Error obteniendo sesión:', sessionError);
      return {
        success: false,
        error: 'Error de autenticación: ' + sessionError.message
      };
    }

    if (!session?.access_token) {
      console.error('No se encontró token de acceso');
      return {
        success: false,
        error: 'No se encontró token de acceso'
      };
    }

    // Preparar FormData
    const formData = new FormData();
    formData.append('file', file);

    // Realizar petición
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        // No incluir Content-Type, se establece automáticamente con FormData
      },
      body: formData,
    });

    // Verificar respuesta
    if (!response.ok) {
      // Manejar errores HTTP específicos
      if (response.status === 0) {
        throw new Error('Error de red: Posible problema CORS');
      }
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const responseData = await response.json();
    console.log('Respuesta exitosa:', responseData);

    return {
      success: true,
      data: responseData
    };

  } catch (error) {
    console.error('Error en la subida:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
}
