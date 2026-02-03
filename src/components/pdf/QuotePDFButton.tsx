'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Download, Loader2 } from 'lucide-react';
import type { QuoteWithDetails } from '@/types/database';

interface QuotePDFButtonProps {
  quote: QuoteWithDetails;
  companyInfo?: {
    name: string;
    subtitle: string;
    address: string;
    phone: string;
    email: string;
  };
}

// Default company info
const DEFAULT_COMPANY_INFO = {
  name: 'Southern California Well Service',
  subtitle: 'Professional Well & Pump Services',
  address: '74309 Highway 111, Palm Desert, CA 92260',
  phone: '(760) 346-0086',
  email: 'info@socalwellservice.com',
};

export function QuotePDFButton({ quote, companyInfo = DEFAULT_COMPANY_INFO }: QuotePDFButtonProps) {
  const [isClient, setIsClient] = useState(false);
  const [PDFComponents, setPDFComponents] = useState<{
    PDFDownloadLink: React.ComponentType<any>;
    QuotePDF: React.ComponentType<any>;
  } | null>(null);

  useEffect(() => {
    setIsClient(true);
    
    // Dynamically import PDF components on client side only
    const loadPDFComponents = async () => {
      try {
        const [pdfRenderer, quotePDF] = await Promise.all([
          import('@react-pdf/renderer'),
          import('./QuotePDF')
        ]);
        
        setPDFComponents({
          PDFDownloadLink: pdfRenderer.PDFDownloadLink,
          QuotePDF: quotePDF.QuotePDF,
        });
      } catch (error) {
        console.error('Failed to load PDF components:', error);
      }
    };
    
    loadPDFComponents();
  }, []);

  // Get logo URL (must be absolute for PDF generation)
  const logoUrl = isClient ? `${window.location.origin}/logo.png` : '';

  if (!isClient || !PDFComponents) {
    return (
      <Button disabled variant="outline">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </Button>
    );
  }

  const { PDFDownloadLink, QuotePDF } = PDFComponents;

  return (
    <PDFDownloadLink
      document={<QuotePDF quote={quote} logoUrl={logoUrl} companyInfo={companyInfo} />}
      fileName={`quote-${quote.quote_number}.pdf`}
    >
      {({ loading, error }: { loading: boolean; error?: Error | null }) => {
        if (error) {
          console.error('PDF generation error:', error);
          return (
            <Button variant="outline" disabled>
              <Download className="h-4 w-4" />
              Error
            </Button>
          );
        }
        
        return loading ? (
          <Button disabled variant="outline">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating...
          </Button>
        ) : (
          <Button variant="outline">
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
        );
      }}
    </PDFDownloadLink>
  );
}
