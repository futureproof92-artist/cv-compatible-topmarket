
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { motion } from 'framer-motion';

interface UploadZoneProps {
  onFilesAccepted: (files: File[]) => void;
}

const UploadZone = ({ onFilesAccepted }: UploadZoneProps) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    onFilesAccepted(acceptedFiles);
  }, [onFilesAccepted]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
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
              : "Arrastra y suelta los CVs aquí"
            }
          </p>
          <p className="text-sm text-gray-500">
            o haz clic para buscar
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default UploadZone;
