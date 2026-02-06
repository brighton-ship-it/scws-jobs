import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export const dynamic = 'force-dynamic';

/**
 * GET /api/quotes/[id]/pdf - Generate quote PDF
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = createServiceClient();

    // Get quote with details
    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        property:properties (id, address, city),
        items:quote_items (*)
      `)
      .eq('id', id)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    // Sort items
    const items = (quote.items || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();
    
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const primaryColor = rgb(0.12, 0.23, 0.30); // #1f3b4d
    const grayColor = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.6, 0.6, 0.6);

    let y = height - 50;

    // Header
    page.drawText('QUOTE', {
      x: 50,
      y,
      size: 28,
      font: helveticaBold,
      color: primaryColor,
    });

    page.drawText(`#${quote.quote_number}`, {
      x: 50,
      y: y - 25,
      size: 14,
      font: helvetica,
      color: lightGray,
    });

    // Company info (right side)
    const companyX = width - 200;
    page.drawText('Southern California Well Service', {
      x: companyX,
      y,
      size: 12,
      font: helveticaBold,
      color: primaryColor,
    });
    page.drawText('1077 Main St, Ramona, CA 92065', {
      x: companyX,
      y: y - 15,
      size: 9,
      font: helvetica,
      color: grayColor,
    });
    page.drawText('(760) 440-8520', {
      x: companyX,
      y: y - 27,
      size: 9,
      font: helvetica,
      color: grayColor,
    });
    page.drawText('brighton@scwellservice.com', {
      x: companyX,
      y: y - 39,
      size: 9,
      font: helvetica,
      color: grayColor,
    });

    y -= 80;

    // Customer info
    page.drawText('CUSTOMER', {
      x: 50,
      y,
      size: 9,
      font: helveticaBold,
      color: lightGray,
    });
    y -= 15;
    page.drawText(quote.customer?.name || 'N/A', {
      x: 50,
      y,
      size: 11,
      font: helveticaBold,
      color: primaryColor,
    });
    y -= 14;
    if (quote.customer?.email) {
      page.drawText(quote.customer.email, {
        x: 50,
        y,
        size: 9,
        font: helvetica,
        color: grayColor,
      });
      y -= 12;
    }
    if (quote.customer?.phone) {
      page.drawText(quote.customer.phone, {
        x: 50,
        y,
        size: 9,
        font: helvetica,
        color: grayColor,
      });
      y -= 12;
    }

    // Property info (right side)
    if (quote.property) {
      page.drawText('PROPERTY', {
        x: 300,
        y: y + 41,
        size: 9,
        font: helveticaBold,
        color: lightGray,
      });
      page.drawText(quote.property.address || '', {
        x: 300,
        y: y + 26,
        size: 10,
        font: helvetica,
        color: grayColor,
      });
      page.drawText(quote.property.city || '', {
        x: 300,
        y: y + 14,
        size: 10,
        font: helvetica,
        color: grayColor,
      });
    }

    y -= 30;

    // Line items table header
    const tableTop = y;
    page.drawRectangle({
      x: 50,
      y: y - 5,
      width: width - 100,
      height: 20,
      color: rgb(0.95, 0.95, 0.95),
    });

    page.drawText('Description', { x: 55, y: y, size: 9, font: helveticaBold, color: grayColor });
    page.drawText('Qty', { x: 350, y: y, size: 9, font: helveticaBold, color: grayColor });
    page.drawText('Price', { x: 400, y: y, size: 9, font: helveticaBold, color: grayColor });
    page.drawText('Total', { x: 480, y: y, size: 9, font: helveticaBold, color: grayColor });

    y -= 25;

    // Line items
    const formatCurrency = (amount: number) => 
      '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    for (const item of items) {
      // Truncate long descriptions
      const desc = (item.description || '').substring(0, 50);
      
      page.drawText(desc, { x: 55, y, size: 9, font: helvetica, color: primaryColor });
      page.drawText(String(item.quantity || 1), { x: 355, y, size: 9, font: helvetica, color: grayColor });
      page.drawText(formatCurrency(item.unit_price || 0), { x: 395, y, size: 9, font: helvetica, color: grayColor });
      page.drawText(formatCurrency(item.total || 0), { x: 475, y, size: 9, font: helvetica, color: grayColor });
      
      y -= 18;
      
      if (y < 150) break; // Don't overflow page
    }

    y -= 10;

    // Totals
    const totalsX = 400;
    page.drawLine({
      start: { x: totalsX - 10, y: y + 5 },
      end: { x: width - 50, y: y + 5 },
      thickness: 1,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 10;
    page.drawText('Subtotal:', { x: totalsX, y, size: 10, font: helvetica, color: grayColor });
    page.drawText(formatCurrency(quote.subtotal || 0), { x: 475, y, size: 10, font: helvetica, color: primaryColor });

    y -= 15;
    page.drawText(`Tax (${quote.tax_rate || 0}%):`, { x: totalsX, y, size: 10, font: helvetica, color: grayColor });
    page.drawText(formatCurrency(quote.tax_amount || 0), { x: 475, y, size: 10, font: helvetica, color: primaryColor });

    y -= 20;
    page.drawText('Total:', { x: totalsX, y, size: 14, font: helveticaBold, color: primaryColor });
    page.drawText(formatCurrency(quote.total || 0), { x: 470, y, size: 14, font: helveticaBold, color: primaryColor });

    // Notes
    if (quote.notes) {
      y -= 40;
      page.drawText('NOTES', { x: 50, y, size: 9, font: helveticaBold, color: lightGray });
      y -= 15;
      const noteLines = quote.notes.split('\n').slice(0, 3);
      for (const line of noteLines) {
        page.drawText(line.substring(0, 80), { x: 50, y, size: 9, font: helvetica, color: grayColor });
        y -= 12;
      }
    }

    // Footer
    page.drawText('Thank you for your business!', {
      x: 50,
      y: 50,
      size: 10,
      font: helvetica,
      color: lightGray,
    });

    if (quote.valid_until) {
      page.drawText(`Valid until: ${new Date(quote.valid_until).toLocaleDateString()}`, {
        x: 50,
        y: 35,
        size: 9,
        font: helvetica,
        color: lightGray,
      });
    }

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Quote-${quote.quote_number}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
