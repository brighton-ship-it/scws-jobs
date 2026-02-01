import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

interface BaseLayoutProps {
  preview: string;
  children: React.ReactNode;
}

export function BaseLayout({ preview, children }: BaseLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <Text style={logo}>SC Well Service</Text>
          </Section>

          {/* Content */}
          <Section style={content}>
            {children}
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              SC Well Service
              <br />
              1234 Industrial Way, Palm Springs, CA 92262
              <br />
              (760) 555-0100 | info@scwellservice.com
            </Text>
            <Text style={footerLinks}>
              <Link href="https://scwellservice.com" style={link}>Website</Link>
              {' | '}
              <Link href="https://scwellservice.com/unsubscribe" style={link}>Unsubscribe</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  maxWidth: '600px',
};

const header = {
  backgroundColor: '#1e40af',
  padding: '24px',
  textAlign: 'center' as const,
};

const logo = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: 'bold' as const,
  margin: '0',
};

const content = {
  padding: '32px 24px',
};

const footer = {
  backgroundColor: '#f6f9fc',
  padding: '24px',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '0 0 16px',
};

const footerLinks = {
  color: '#8898aa',
  fontSize: '12px',
  margin: '0',
};

const link = {
  color: '#1e40af',
  textDecoration: 'none',
};
