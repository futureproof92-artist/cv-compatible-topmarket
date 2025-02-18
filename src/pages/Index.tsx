
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Upload, Check, X, Search, Loader2 } from 'lucide-react';
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any>(null);
  const { toast } = useToast();

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

  const isValidForAnalysis = files.length > 0 && requirements.title && requirements.skills.length > 0;

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      // Aquí iría la lógica de análisis
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulación de análisis
      
      // Simulación de resultados
      setResults({
        analyzed: files.length,
        matches: files.map(file => ({
          filename: file.name,
          match: Math.round(Math.random() * 100),
          skills: requirements.skills.map(skill => ({
            name: skill,
            found: Math.random() > 0.5
          }))
        }))
      });

      toast({
        title: "Análisis completado",
        description: `Se han analizado ${files.length} CV(s) exitosamente.`
      });
    } catch (error) {
      toast({
        title: "Error en el análisis",
        description: "Hubo un problema al analizar los CVs. Por favor, intenta nuevamente.",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
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

        <div className="mt-8 text-center">
          <Button
            size="lg"
            onClick={handleAnalyze}
            disabled={!isValidForAnalysis || isAnalyzing}
            className="px-8"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analizando...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Analizar CVs
              </>
            )}
          </Button>
        </div>

        <AnimatePresence>
          {results && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-12 bg-white rounded-lg shadow-sm border p-6"
            >
              <h2 className="text-2xl font-semibold mb-6">Resultados del Análisis</h2>
              <div className="space-y-4">
                {results.matches.map((match: any, index: number) => (
                  <div
                    key={index}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-medium">{match.filename}</h3>
                      <span className={`text-lg font-semibold ${
                        match.match >= 75 ? 'text-green-600' :
                        match.match >= 50 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {match.match}% de coincidencia
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {match.skills.map((skill: any, skillIndex: number) => (
                        <span
                          key={skillIndex}
                          className={`px-3 py-1 rounded-full text-sm ${
                            skill.found
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {skill.name}
                          {skill.found ? 
                            <Check className="inline-block ml-1 h-4 w-4" /> : 
                            <X className="inline-block ml-1 h-4 w-4" />
                          }
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>;
};

export default Index;
