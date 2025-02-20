
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface UploadZoneProps {
  onFilesAccepted: (files: File[], processedData?: any) => void;
}

const UploadZone = ({ onFilesAccepted }: UploadZoneProps) => {
  const { toast } = useToast();

  const processFile = async (file: File) => {
    console.log('Iniciando procesamiento del archivo:', file.name, 'tipo:', file.type, 'tamaño:', file.size);
    
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error('Error obteniendo sesión:', sessionError);
        throw new Error('Error de autenticación');
      }

      if (!session?.access_token) {
        console.error('No se encontró token de acceso');
        throw new Error('No se encontró token de acceso');
      }

      console.log('Sesión válida, preparando FormData');
      const formData = new FormData();
      formData.append('file', file);

      const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-document`;
      console.log('URL de la función:', functionUrl);

      // Modificamos la configuración de la petición
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
        mode: 'cors',
        credentials: 'omit', // Cambiamos a 'omit' para evitar el envío de cookies
      });

      console.log('Respuesta status:', response.status);
      console.log('Respuesta headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error en la respuesta:', {
          status: response.status,
          statusText: response.statusText,
          errorData
        });
        throw new Error(`Error HTTP: ${response.status} - ${errorData.error || response.statusText}`);
      }

      const data = await response.json();
      console.log('Respuesta de process-document:', data);

      if (!data?.document?.id) {
        console.error('No se recibió document.id en la respuesta');
        throw new Error('No se recibió ID del documento');
      }

      toast({
        title: "Archivo procesado exitosamente",
        description: `Se ha procesado el archivo ${file.name}`,
      });

      return data;
    } catch (error) {
      console.error('Error procesando archivo:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace disponible');
      
      toast({
        title: "Error al procesar el archivo",
        description: error instanceof Error ? error.message : "Hubo un problema al procesar el archivo. Por favor, intenta nuevamente.",
        variant: "destructive"
      });
      throw error;
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    console.log('Archivos recibidos en onDrop:', acceptedFiles.map(f => ({
      nombre: f.name,
      tipo: f.type,
      tamaño: f.size
    })));
    
    for (const file of acceptedFiles) {
      try {
        console.log('Procesando archivo:', file.name);
        const processedData = await processFile(file);
        console.log('Datos procesados para', file.name, ':', processedData);
        onFilesAccepted([file], processedData);
      } catch (error) {
        console.error(`Error procesando archivo ${file.name}:`, error);
        console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace disponible');
      }
    }
  }, [onFilesAccepted]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg']
    },
    multiple: true
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
        transition-all duration-200 ease-in-out
        ${isDragActive 
          ? 'border-blue-500 bg-blue-50' 
          : 'border-gray-300 hover:border-gray-400 bg-white'
        }
      `}
    >
      <input {...getInputProps()} />
      <motion.div
        initial={{ scale: 1 }}
        animate={{ scale: isDragActive ? 1.05 : 1 }}
        className="flex flex-col items-center justify-center space-y-4"
      >
        <Upload 
          className={`h-12 w-12 ${
            isDragActive ? 'text-blue-500' : 'text-gray-400'
          }`}
        />
        <div className="space-y-2">
          <p className="text-lg font-medium text-gray-700">
            {isDragActive 
              ? "Suelta los archivos aquí" 
              : "Arrastra y suelta los archivos aquí"
            }
          </p>
          <p className="text-sm text-gray-500">
            o haz clic para buscar
          </p>
          <p className="text-xs text-gray-400">
            Formatos soportados: PDF, DOC, DOCX, PNG, JPG
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default UploadZone;
