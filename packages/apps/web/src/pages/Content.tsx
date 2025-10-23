import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrandStore } from '../stores/brandStore';
import { ContentCalendar } from '../components/ContentCalendar';
import { Alert, AlertDescription } from '../components/ui/alert';
import { AlertCircle } from 'lucide-react';

export function Content() {
  const { selectedBrand } = useBrandStore();
  const navigate = useNavigate();

  // Redirect to dashboard if no brand selected
  useEffect(() => {
    if (!selectedBrand) {
      navigate('/dashboard');
    }
  }, [selectedBrand, navigate]);

  if (!selectedBrand) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Please select a brand to view content calendar</AlertDescription>
      </Alert>
    );
  }

  return <ContentCalendar brandId={selectedBrand.id} brandName={selectedBrand.name} />;
}
