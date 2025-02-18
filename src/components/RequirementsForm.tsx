
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Requirements {
  title: string;
  skills: string[];
  experience: string;
  location: string;
  education: string;
}

interface RequirementsFormProps {
  requirements: Requirements;
  setRequirements: (requirements: Requirements) => void;
}

const RequirementsForm = ({ requirements, setRequirements }: RequirementsFormProps) => {
  const [skillInput, setSkillInput] = useState('');

  const handleAddSkill = () => {
    if (skillInput.trim()) {
      setRequirements({
        ...requirements,
        skills: [...requirements.skills, skillInput.trim()]
      });
      setSkillInput('');
    }
  };

  const removeSkill = (index: number) => {
    setRequirements({
      ...requirements,
      skills: requirements.skills.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6 space-y-6">
      <h3 className="text-lg font-medium mb-4">Requisitos del Puesto</h3>
      
      <div className="space-y-4">
        <div>
          <Label htmlFor="title">Título del Puesto</Label>
          <Input
            id="title"
            value={requirements.title}
            onChange={(e) => setRequirements({ ...requirements, title: e.target.value })}
            placeholder="ej., Ingeniero de Software Senior"
          />
        </div>

        <div>
          <Label htmlFor="skills">Habilidades Requeridas</Label>
          <div className="flex space-x-2 mb-2">
            <Input
              id="skills"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              placeholder="ej., Python"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddSkill();
                }
              }}
            />
            <Button 
              type="button"
              onClick={handleAddSkill}
              variant="secondary"
            >
              Agregar
            </Button>
          </div>
          
          <div className="flex flex-wrap gap-2 mt-2">
            {requirements.skills.map((skill, index) => (
              <span
                key={index}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800"
              >
                {skill}
                <button
                  type="button"
                  className="ml-2 text-blue-600 hover:text-blue-800"
                  onClick={() => removeSkill(index)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="experience">Experiencia Requerida</Label>
          <Input
            id="experience"
            value={requirements.experience}
            onChange={(e) => setRequirements({ ...requirements, experience: e.target.value })}
            placeholder="ej., 5+ años"
          />
        </div>

        <div>
          <Label htmlFor="location">Ubicación</Label>
          <Input
            id="location"
            value={requirements.location}
            onChange={(e) => setRequirements({ ...requirements, location: e.target.value })}
            placeholder="ej., Ciudad de México"
          />
        </div>

        <div>
          <Label htmlFor="education">Requisitos de Educación</Label>
          <Textarea
            id="education"
            value={requirements.education}
            onChange={(e) => setRequirements({ ...requirements, education: e.target.value })}
            placeholder="ej., Licenciatura en Ingeniería Informática"
            rows={3}
          />
        </div>
      </div>
    </div>
  );
};

export default RequirementsForm;
