'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// Dynamically import PDF components to avoid SSR issues
const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFViewer),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-gray-500">Loading PDF preview...</p>
        </div>
      </div>
    )
  }
);

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFDownloadLink),
  { 
    ssr: false,
    loading: () => (
      <Button disabled variant="outline">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </Button>
    )
  }
);

interface PDFPreviewProps {
  document: React.ReactElement;
  fileName: string;
  showDownload?: boolean;
  height?: string;
}

export function PDFPreview({ 
  document, 
  fileName, 
  showDownload = true,
  height = '600px'
}: PDFPreviewProps) {
  const [showViewer, setShowViewer] = useState(false);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setShowViewer(!showViewer)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              showViewer
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {showViewer ? 'Hide Preview' : 'Show PDF Preview'}
          </button>
        </div>
        
        {showDownload && (
          <PDFDownloadLink document={document} fileName={fileName}>
            {({ loading }) =>
              loading ? (
                <Button disabled variant="outline">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </Button>
              ) : (
                <Button variant="outline">
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              )
            }
          </PDFDownloadLink>
        )}
      </div>

      {/* PDF Viewer */}
      {showViewer && (
        <div 
          className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100"
          style={{ height }}
        >
          <PDFViewer
            style={{ width: '100%', height: '100%', border: 'none' }}
            showToolbar={true}
          >
            {document}
          </PDFViewer>
        </div>
      )}
    </div>
  );
}

// Standalone download button component
interface PDFDownloadButtonProps {
  document: React.ReactElement;
  fileName: string;
  variant?: 'default' | 'outline' | 'secondary';
  label?: string;
}

export function PDFDownloadButton({ 
  document, 
  fileName, 
  variant = 'outline',
  label = 'Download PDF'
}: PDFDownloadButtonProps) {
  return (
    <PDFDownloadLink document={document} fileName={fileName}>
      {({ loading }) =>
        loading ? (
          <Button disabled variant={variant}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating...
          </Button>
        ) : (
          <Button variant={variant}>
            <Download className="h-4 w-4" />
            {label}
          </Button>
        )
      }
    </PDFDownloadLink>
  );
}
