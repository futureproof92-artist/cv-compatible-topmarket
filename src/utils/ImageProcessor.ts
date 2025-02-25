
import { supabase } from "@/integrations/supabase/client";

// Función principal para procesar imágenes usando Google Vision API
export const processImage = async (file: File): Promise<string> => {
  try {
    console.log('Iniciando procesamiento de imagen:', file.name);
    
    // Convertir el archivo a base64
    const base64Data = await fileToBase64(file);
    
    // Llamar a la función de Supabase que maneja la comunicación con Google Vision API
    const { data, error } = await supabase.functions.invoke('process-image', {
      body: {
        image: base64Data.split(',')[1], // Removemos el prefijo data:image/...
        filename: file.name
      }
    });

    if (error) {
      console.error('Error en la función process-image:', error);
      throw error;
    }

    console.log('Respuesta del procesamiento de imagen:', data);

    if (data?.text) {
      return data.text;
    }

    return 'No se encontró texto en la imagen';

  } catch (error) {
    console.error('Error procesando imagen:', error);
    throw new Error('Error al procesar la imagen: ' + (error instanceof Error ? error.message : 'Error desconocido'));
  }
};

// Función auxiliar para convertir archivo a base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Error al convertir archivo a base64'));
      }
    };
    reader.onerror = (error) => reject(error);
  });
};

// Función para validar que el archivo es una imagen soportada
export const validateImage = (file: File): boolean => {
  const supportedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  return supportedTypes.includes(file.type);
};

// Función para verificar el tamaño de la imagen
export const validateImageSize = (file: File, maxSizeInMB: number = 10): boolean => {
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
  return file.size <= maxSizeInBytes;
};
