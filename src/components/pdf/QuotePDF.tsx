'use client';

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import type { QuoteWithDetails, Signature } from '@/types/database';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1f2937',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 30,
  },
  headerLeft: {
    flexDirection: 'column',
  },
  logo: {
    width: 120,
    height: 'auto',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  quoteNumber: {
    fontSize: 14,
    color: '#6b7280',
  },
  companySection: {
    alignItems: 'flex-end',
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0ea5e9',
    textAlign: 'right',
  },
  companySubtitle: {
    fontSize: 11,
    color: '#4b5563',
    textAlign: 'right',
    marginTop: 2,
  },
  companyInfo: {
    fontSize: 9,
    color: '#6b7280',
    textAlign: 'right',
    marginTop: 4,
    lineHeight: 1.5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  column: {
    flex: 1,
  },
  customerName: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  customerInfo: {
    fontSize: 10,
    color: '#4b5563',
    lineHeight: 1.4,
  },
  dateLabel: {
    fontSize: 9,
    color: '#6b7280',
  },
  dateValue: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  table: {
    marginTop: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#0ea5e9',
    paddingBottom: 8,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: '#fafafa',
  },
  colDescription: {
    flex: 4,
  },
  colQty: {
    flex: 1,
    textAlign: 'right',
  },
  colPrice: {
    flex: 1.5,
    textAlign: 'right',
  },
  colTotal: {
    flex: 1.5,
    textAlign: 'right',
  },
  headerText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemDescription: {
    fontSize: 10,
    color: '#1f2937',
  },
  itemDetailDescription: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 1.4,
  },
  itemType: {
    fontSize: 8,
    color: '#9ca3af',
    textTransform: 'capitalize',
    marginTop: 2,
  },
  nonTaxableBadge: {
    fontSize: 7,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
    marginLeft: 4,
  },
  itemText: {
    fontSize: 10,
    color: '#4b5563',
  },
  itemTotal: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  totalsSection: {
    marginTop: 24,
    alignItems: 'flex-end',
  },
  totalsBox: {
    width: 220,
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 4,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 10,
    color: '#6b7280',
  },
  totalValue: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 2,
    borderTopColor: '#0ea5e9',
    marginTop: 8,
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  grandTotalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0ea5e9',
  },
  notes: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  notesText: {
    fontSize: 10,
    color: '#4b5563',
    lineHeight: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
    textAlign: 'center',
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  footerText: {
    fontSize: 10,
    color: '#4b5563',
    fontWeight: 'bold',
  },
  footerSmall: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 4,
  },
  validUntilBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginTop: 8,
  },
  validUntilText: {
    fontSize: 9,
    color: '#92400e',
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginTop: 4,
  },
  draftBadge: {
    backgroundColor: '#f3f4f6',
  },
  sentBadge: {
    backgroundColor: '#dbeafe',
  },
  acceptedBadge: {
    backgroundColor: '#d1fae5',
  },
  signatureSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  signatureBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 16,
  },
  signatureImageContainer: {
    flex: 1,
    paddingRight: 24,
  },
  signatureImage: {
    width: 200,
    height: 60,
    objectFit: 'contain',
  },
  signatureDetails: {
    flex: 1,
    alignItems: 'flex-end',
  },
  signatureLabel: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 2,
  },
  signatureName: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  signatureDate: {
    fontSize: 9,
    color: '#4b5563',
  },
  signedBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 8,
  },
  signedBadgeText: {
    fontSize: 9,
    color: '#047857',
    fontWeight: 'bold',
  },
});

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

interface QuotePDFProps {
  quote: QuoteWithDetails;
  logoUrl?: string;
  signature?: Signature | null;
  companyInfo?: {
    name: string;
    subtitle: string;
    address: string;
    phone: string;
    email: string;
  };
}

export function QuotePDF({ quote, logoUrl, signature, companyInfo }: QuotePDFProps) {
  const company = companyInfo || {
    name: 'Southern California Well Service',
    subtitle: 'Professional Well & Pump Services',
    address: '74309 Highway 111, Palm Desert, CA 92260',
    phone: '(760) 346-0086',
    email: 'info@socalwellservice.com',
  };

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header with Logo */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoUrl && (
              <Image src={logoUrl} style={styles.logo} />
            )}
            <Text style={styles.title}>QUOTE</Text>
            <Text style={styles.quoteNumber}>#{quote.quote_number}</Text>
          </View>
          <View style={styles.companySection}>
            {!logoUrl && (
              <>
                <Text style={styles.companyName}>{company.name}</Text>
                <Text style={styles.companySubtitle}>{company.subtitle}</Text>
              </>
            )}
            <Text style={styles.companyInfo}>
              {company.address}
            </Text>
            <Text style={styles.companyInfo}>
              {company.phone}
            </Text>
            <Text style={styles.companyInfo}>
              {company.email}
            </Text>
          </View>
        </View>

        {/* Customer & Dates */}
        <View style={styles.row}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>Prepared For</Text>
            <Text style={styles.customerName}>{quote.customer.name}</Text>
            {quote.customer.billing_address && (
              <Text style={styles.customerInfo}>{quote.customer.billing_address}</Text>
            )}
            {quote.customer.email && (
              <Text style={styles.customerInfo}>{quote.customer.email}</Text>
            )}
            {quote.customer.phone && (
              <Text style={styles.customerInfo}>{quote.customer.phone}</Text>
            )}
            
            {quote.property && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionTitle}>Service Location</Text>
                <Text style={styles.customerInfo}>
                  {quote.property.address}
                  {quote.property.city && `, ${quote.property.city}`}
                  {quote.property.zip && ` ${quote.property.zip}`}
                </Text>
              </View>
            )}
          </View>
          <View style={{ width: 160, alignItems: 'flex-end' }}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.dateLabel}>Quote Date</Text>
              <Text style={styles.dateValue}>{format(new Date(quote.created_at), 'MMMM d, yyyy')}</Text>
            </View>
            {quote.valid_until && (
              <View>
                <Text style={styles.dateLabel}>Valid Until</Text>
                <Text style={styles.dateValue}>{format(new Date(quote.valid_until), 'MMMM d, yyyy')}</Text>
                {new Date(quote.valid_until) > new Date() && (
                  <View style={styles.validUntilBadge}>
                    <Text style={styles.validUntilText}>
                      {Math.ceil((new Date(quote.valid_until).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days remaining
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.headerText, styles.colDescription]}>Description</Text>
            <Text style={[styles.headerText, styles.colQty]}>Qty</Text>
            <Text style={[styles.headerText, styles.colPrice]}>Rate</Text>
            <Text style={[styles.headerText, styles.colTotal]}>Amount</Text>
          </View>
          {quote.items.map((item, index) => (
            <View key={item.id} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={styles.colDescription}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.itemDescription}>{item.description}</Text>
                  {item.taxable === false && (
                    <Text style={styles.nonTaxableBadge}>Non-taxable</Text>
                  )}
                </View>
                {item.item_description && (
                  <Text style={styles.itemDetailDescription}>{item.item_description}</Text>
                )}
                {item.item_type && <Text style={styles.itemType}>{item.item_type}</Text>}
              </View>
              <Text style={[styles.itemText, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.itemText, styles.colPrice]}>{formatCurrency(item.unit_price)}</Text>
              <Text style={[styles.itemTotal, styles.colTotal]}>{formatCurrency(item.total)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(quote.subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax ({quote.tax_rate}%)</Text>
              <Text style={styles.totalValue}>{formatCurrency(quote.tax_amount)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{formatCurrency(quote.total)}</Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {quote.notes && (
          <View style={styles.notes}>
            <Text style={styles.sectionTitle}>Notes & Terms</Text>
            <Text style={styles.notesText}>{quote.notes}</Text>
          </View>
        )}

        {/* Signature Section */}
        {signature && (
          <View style={styles.signatureSection}>
            <Text style={styles.sectionTitle}>Customer Acceptance</Text>
            <View style={styles.signatureBox}>
              <View style={styles.signatureImageContainer}>
                <Image src={signature.signature_data} style={styles.signatureImage} />
                <View style={{ borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 4, marginTop: 4 }}>
                  <Text style={{ fontSize: 8, color: '#6b7280' }}>Customer Signature</Text>
                </View>
              </View>
              <View style={styles.signatureDetails}>
                <View style={styles.signedBadge}>
                  <Text style={styles.signedBadgeText}>✓ ACCEPTED</Text>
                </View>
                <Text style={styles.signatureLabel}>Signed by:</Text>
                <Text style={styles.signatureName}>{signature.signer_name}</Text>
                <Text style={styles.signatureDate}>
                  {format(new Date(signature.signed_at), 'MMMM d, yyyy \'at\' h:mm a')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Thank you for considering {company.name}!</Text>
          <Text style={styles.footerSmall}>
            Questions? Contact us at {company.phone} or {company.email}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
