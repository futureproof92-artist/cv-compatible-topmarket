
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
      <h3 className="text-lg font-medium mb-4">Job Requirements</h3>
      
      <div className="space-y-4">
        <div>
          <Label htmlFor="title">Job Title</Label>
          <Input
            id="title"
            value={requirements.title}
            onChange={(e) => setRequirements({ ...requirements, title: e.target.value })}
            placeholder="e.g., Senior Software Engineer"
          />
        </div>

        <div>
          <Label htmlFor="skills">Required Skills</Label>
          <div className="flex space-x-2 mb-2">
            <Input
              id="skills"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              placeholder="e.g., Python"
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
              Add
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
          <Label htmlFor="experience">Required Experience</Label>
          <Input
            id="experience"
            value={requirements.experience}
            onChange={(e) => setRequirements({ ...requirements, experience: e.target.value })}
            placeholder="e.g., 5+ years"
          />
        </div>

        <div>
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={requirements.location}
            onChange={(e) => setRequirements({ ...requirements, location: e.target.value })}
            placeholder="e.g., New York"
          />
        </div>

        <div>
          <Label htmlFor="education">Education Requirements</Label>
          <Textarea
            id="education"
            value={requirements.education}
            onChange={(e) => setRequirements({ ...requirements, education: e.target.value })}
            placeholder="e.g., Bachelor's degree in Computer Science"
            rows={3}
          />
        </div>
      </div>
    </div>
  );
};

export default RequirementsForm;
