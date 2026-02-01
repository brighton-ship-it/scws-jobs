import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

interface QuoteSentEmailProps {
  customerName: string;
  quoteNumber: string;
  totalAmount: string;
  validUntil: string;
  jobDescription: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }>;
  approveUrl: string;
  pdfUrl: string;
}

export function QuoteSentEmail({
  customerName = 'Robert',
  quoteNumber = 'QT-2024-00001',
  totalAmount = '$1,250.00',
  validUntil = 'February 28, 2025',
  jobDescription = 'Pump Replacement - 45678 Desert View Rd',
  lineItems = [
    { description: 'Submersible Pump - Grundfos 25S50', quantity: 1, unitPrice: '$850.00', total: '$850.00' },
    { description: 'Labor - Installation', quantity: 4, unitPrice: '$75.00', total: '$300.00' },
    { description: 'Materials & Supplies', quantity: 1, unitPrice: '$100.00', total: '$100.00' },
  ],
  approveUrl = 'https://app.scwellservice.com/quotes/1/approve',
  pdfUrl = 'https://app.scwellservice.com/quotes/1/pdf',
}: QuoteSentEmailProps) {
  return (
    <BaseLayout preview={`Quote ${quoteNumber} for ${totalAmount}`}>
      <Heading style={heading}>Quote from SC Well Service</Heading>
      
      <Text style={paragraph}>
        Hi {customerName},
      </Text>
      
      <Text style={paragraph}>
        Thank you for your interest in our services. Please review the quote below for 
        your requested work:
      </Text>

      <Section style={quoteCard}>
        <table style={quoteHeader}>
          <tbody>
            <tr>
              <td>
                <Text style={quoteLabel}>Quote Number</Text>
                <Text style={quoteNumberStyle}>{quoteNumber}</Text>
              </td>
              <td style={{ textAlign: 'right' as const }}>
                <Text style={quoteLabel}>Valid Until</Text>
                <Text style={validDate}>{validUntil}</Text>
              </td>
            </tr>
          </tbody>
        </table>

        <Hr style={divider} />

        <Text style={jobDescriptionStyle}>{jobDescription}</Text>

        <Hr style={divider} />

        {/* Line Items */}
        <table style={lineItemsTable}>
          <thead>
            <tr>
              <th style={tableHeader}>Description</th>
              <th style={tableHeaderRight}>Qty</th>
              <th style={tableHeaderRight}>Price</th>
              <th style={tableHeaderRight}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item, index) => (
              <tr key={index}>
                <td style={tableCell}>{item.description}</td>
                <td style={tableCellRight}>{item.quantity}</td>
                <td style={tableCellRight}>{item.unitPrice}</td>
                <td style={tableCellRight}>{item.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Hr style={divider} />

        <table style={totalTable}>
          <tbody>
            <tr>
              <td style={totalLabel}>Total</td>
              <td style={totalAmount}>{totalAmount}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={buttonSection}>
        <Button style={primaryButton} href={approveUrl}>
          ✓ Approve Quote
        </Button>
      </Section>

      <Text style={orText}>or</Text>

      <Section style={buttonSection}>
        <Button style={secondaryButton} href={pdfUrl}>
          Download PDF
        </Button>
      </Section>

      <Hr style={divider} />

      <Text style={paragraph}>
        Have questions about this quote? Feel free to reply to this email or give us a 
        call at (760) 555-0100. We&apos;re happy to discuss any modifications or answer 
        any questions you may have.
      </Text>

      <Text style={expiryNote}>
        ⏰ This quote is valid until {validUntil}. Prices may change after this date.
      </Text>
    </BaseLayout>
  );
}

export default QuoteSentEmail;

const heading = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1f2937',
  margin: '0 0 24px',
};

const paragraph = {
  fontSize: '14px',
  lineHeight: '24px',
  color: '#4b5563',
  margin: '0 0 16px',
};

const quoteCard = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
};

const quoteHeader = {
  width: '100%',
};

const quoteLabel = {
  fontSize: '12px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px',
};

const quoteNumberStyle = {
  fontSize: '16px',
  fontWeight: '600' as const,
  color: '#1f2937',
  margin: '0',
};

const validDate = {
  fontSize: '14px',
  fontWeight: '500' as const,
  color: '#1f2937',
  margin: '0',
};

const divider = {
  borderColor: '#e5e7eb',
  margin: '16px 0',
};

const jobDescriptionStyle = {
  fontSize: '16px',
  fontWeight: '600' as const,
  color: '#1f2937',
  margin: '0',
};

const lineItemsTable = {
  width: '100%',
  borderCollapse: 'collapse' as const,
};

const tableHeader = {
  fontSize: '12px',
  fontWeight: '600' as const,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  textAlign: 'left' as const,
  padding: '8px 0',
  borderBottom: '1px solid #e5e7eb',
};

const tableHeaderRight = {
  ...tableHeader,
  textAlign: 'right' as const,
};

const tableCell = {
  fontSize: '14px',
  color: '#1f2937',
  padding: '12px 0',
  borderBottom: '1px solid #f3f4f6',
};

const tableCellRight = {
  ...tableCell,
  textAlign: 'right' as const,
};

const totalTable = {
  width: '100%',
};

const totalLabel = {
  fontSize: '16px',
  fontWeight: '600' as const,
  color: '#1f2937',
  textAlign: 'left' as const,
};

const totalAmount = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#1e40af',
  textAlign: 'right' as const,
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '16px 0',
};

const primaryButton = {
  backgroundColor: '#059669',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600' as const,
  padding: '14px 32px',
  textDecoration: 'none',
};

const secondaryButton = {
  backgroundColor: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  color: '#374151',
  fontSize: '14px',
  fontWeight: '500' as const,
  padding: '10px 24px',
  textDecoration: 'none',
};

const orText = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  margin: '0',
};

const expiryNote = {
  fontSize: '13px',
  color: '#92400e',
  backgroundColor: '#fef3c7',
  padding: '12px 16px',
  borderRadius: '6px',
  margin: '24px 0 0',
  textAlign: 'center' as const,
};
