import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Upload, Check, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import UploadZone from '@/components/UploadZone';
import RequirementsForm from '@/components/RequirementsForm';
const Index = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [requirements, setRequirements] = useState({
    title: '',
    skills: [],
    experience: '',
    location: '',
    education: ''
  });
  const {
    toast
  } = useToast();
  const handleFilesAccepted = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
    toast({
      title: "Archivos subidos exitosamente",
      description: `Se han agregado ${acceptedFiles.length} archivo(s).`
    });
  }, [toast]);
  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };
  return <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">Checador de CV's</h1>
          <p className="mt-3 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:mt-5 md:text-xl md:max-w-3xl font-normal">Sube CVs y compáralos con los requisitos del puesto usando nuestra IA</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <UploadZone onFilesAccepted={handleFilesAccepted} />
            
            <AnimatePresence>
              {files.length > 0 && <motion.div initial={{
              opacity: 0,
              y: 20
            }} animate={{
              opacity: 1,
              y: 0
            }} exit={{
              opacity: 0,
              y: -20
            }} className="bg-white rounded-lg shadow-sm border p-4">
                  <h3 className="text-lg font-medium mb-4">Archivos Subidos</h3>
                  <div className="space-y-2">
                    {files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                        <div className="flex items-center space-x-3">
                          <FileText className="h-5 w-5 text-blue-500" />
                          <span className="text-sm text-gray-700">{file.name}</span>
                        </div>
                        <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-500 transition-colors">
                          <X className="h-5 w-5" />
                        </button>
                      </div>)}
                  </div>
                </motion.div>}
            </AnimatePresence>
          </div>

          <div>
            <RequirementsForm requirements={requirements} setRequirements={setRequirements} />
          </div>
        </div>
      </div>
    </div>;
};
export default Index;