import {
  Button,
  Heading,
  Hr,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

interface JobAssignedEmailProps {
  recipientName: string;
  jobType: string;
  customerName: string;
  propertyAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  estimatedDuration: string;
  description?: string;
  jobUrl: string;
}

export function JobAssignedEmail({
  recipientName = 'Mike',
  jobType = 'Pump Inspection',
  customerName = 'Johnson Ranch',
  propertyAddress = '45678 Desert View Rd, Borrego Springs, CA',
  scheduledDate = 'January 15, 2025',
  scheduledTime = '9:00 AM',
  estimatedDuration = '2 hours',
  description = 'Annual pump inspection and performance test',
  jobUrl = 'https://app.scwellservice.com/jobs/1',
}: JobAssignedEmailProps) {
  return (
    <BaseLayout preview={`New job assigned: ${jobType} at ${customerName}`}>
      <Heading style={heading}>New Job Assigned</Heading>
      
      <Text style={paragraph}>
        Hi {recipientName},
      </Text>
      
      <Text style={paragraph}>
        You&apos;ve been assigned a new job. Here are the details:
      </Text>

      <Section style={jobCard}>
        <Text style={jobType}>{jobType}</Text>
        <Text style={customerStyle}>{customerName}</Text>
        <Hr style={divider} />
        
        <table style={detailsTable}>
          <tbody>
            <tr>
              <td style={labelCell}>📍 Location</td>
              <td style={valueCell}>{propertyAddress}</td>
            </tr>
            <tr>
              <td style={labelCell}>📅 Date</td>
              <td style={valueCell}>{scheduledDate}</td>
            </tr>
            <tr>
              <td style={labelCell}>🕐 Time</td>
              <td style={valueCell}>{scheduledTime}</td>
            </tr>
            <tr>
              <td style={labelCell}>⏱️ Duration</td>
              <td style={valueCell}>{estimatedDuration}</td>
            </tr>
          </tbody>
        </table>

        {description && (
          <>
            <Hr style={divider} />
            <Text style={descriptionLabel}>Description</Text>
            <Text style={descriptionText}>{description}</Text>
          </>
        )}
      </Section>

      <Section style={buttonSection}>
        <Button style={button} href={jobUrl}>
          View Job Details
        </Button>
      </Section>

      <Text style={paragraph}>
        If you have any questions about this job, please contact the office.
      </Text>
    </BaseLayout>
  );
}

export default JobAssignedEmail;

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

const jobCard = {
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 0',
};

const jobType = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#1f2937',
  margin: '0 0 4px',
};

const customerStyle = {
  fontSize: '16px',
  color: '#6b7280',
  margin: '0',
};

const divider = {
  borderColor: '#e5e7eb',
  margin: '16px 0',
};

const detailsTable = {
  width: '100%',
};

const labelCell = {
  fontSize: '14px',
  color: '#6b7280',
  padding: '4px 0',
  width: '120px',
};

const valueCell = {
  fontSize: '14px',
  color: '#1f2937',
  fontWeight: '500' as const,
  padding: '4px 0',
};

const descriptionLabel = {
  fontSize: '12px',
  fontWeight: '600' as const,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 8px',
};

const descriptionText = {
  fontSize: '14px',
  color: '#4b5563',
  margin: '0',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#1e40af',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  padding: '12px 24px',
  textDecoration: 'none',
};
