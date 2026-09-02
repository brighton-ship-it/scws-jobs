import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// SCWS Company Info - hardcoded for now, could come from settings
const SCWS_INFO = {
  name: 'Southern California Well Service',
  contact: 'Brighton',
  license: '1086994',
  address: '1077 Main Street, Unit B',
  city: 'Ramona',
  state: 'CA',
  zip: '92065',
  phone: '(760) 440-8520',
  email: 'permits@scws.com',
};

interface PermitRequest {
  county: 'san_diego' | 'riverside' | 'san_bernardino';
  
  // Property Owner Info (from CRM customer)
  owner: {
    name: string;
    contact?: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    email: string;
  };
  
  // Property/Well Location (from research)
  property: {
    apn: string;
    siteAddress: string;
    city: string;
    state: string;
    zip: string;
    latitude: string;
    longitude: string;
    waterDistrict?: string;
  };
  
  // Proposed Well Info (user input)
  proposedWell: {
    purpose: 'domestic_drinking' | 'domestic_other' | 'public' | 'industrial' | 'irrigation' | 'other';
    purposeOther?: string;
    workType: 'new' | 'reconstruction' | 'destruction';
    depth: string; // feet
    boreholeDiameter: string; // inches
    casingDiameter?: string;
    casingMaterial?: string;
    drillingMethod?: string;
    screenFrom?: string;
    screenTo?: string;
  };
}

/**
 * Fill San Diego County Well Permit Application
 */
async function fillSanDiegoPermit(pdfDoc: PDFDocument, data: PermitRequest): Promise<void> {
  const form = pdfDoc.getForm();
  
  // Helper to safely set text field
  const setTextField = (name: string, value: string | undefined) => {
    try {
      if (value) {
        const field = form.getTextField(name);
        field.setText(value);
      }
    } catch (e) {
      console.warn(`Field not found: ${name}`);
    }
  };
  
  // Helper to safely check checkbox
  const setCheckBox = (name: string, checked: boolean) => {
    try {
      if (checked) {
        const field = form.getCheckBox(name);
        field.check();
      }
    } catch (e) {
      console.warn(`Checkbox not found: ${name}`);
    }
  };
  
  // Property Owner Info
  setTextField('PROPERTY OWNER', data.owner.name);
  setTextField('Contact Person', data.owner.contact || data.owner.name);
  setTextField('Mailing Address', data.owner.address);
  setTextField('City', data.owner.city);
  setTextField('State', data.owner.state);
  setTextField('Zip', data.owner.zip);
  setTextField('Phone', data.owner.phone);
  setTextField('EMail Address', data.owner.email);
  
  // Well Location
  setTextField('WELL LOCATION  ASSESSORS PARCEL NUMBER', data.property.apn);
  setTextField('APN', data.property.apn);
  setTextField('Site Address', data.property.siteAddress);
  setTextField('City_2', data.property.city);
  setTextField('State_2', data.property.state);
  setTextField('Zip_2', data.property.zip);
  setTextField('Well Latitude', data.property.latitude);
  setTextField('Well Longitude', data.property.longitude);
  setTextField('Water District', data.property.waterDistrict || '');
  
  // Drilling Contractor (SCWS)
  setTextField('DRILLING CONTRACTOR', SCWS_INFO.name);
  setTextField('Contact Person_2', SCWS_INFO.contact);
  setTextField('Valid C57 License', SCWS_INFO.license);
  setTextField('Mailing Address_2', SCWS_INFO.address);
  setTextField('City_3', SCWS_INFO.city);
  setTextField('State_3', SCWS_INFO.state);
  setTextField('Zip_3', SCWS_INFO.zip);
  setTextField('Phone_2', SCWS_INFO.phone);
  setTextField('EMail Address_2', SCWS_INFO.email);
  
  // Well Purpose
  switch (data.proposedWell.purpose) {
    case 'domestic_drinking':
      setCheckBox('DomesticPrivate for drinking water', true);
      break;
    case 'domestic_other':
      setCheckBox('DomesticPrivate for uses other than drinking water', true);
      break;
    case 'public':
      setCheckBox('Public', true);
      break;
    case 'industrial':
      setCheckBox('Industrial', true);
      break;
    case 'other':
    case 'irrigation':
      setCheckBox('Other', true);
      setTextField('Other_2', data.proposedWell.purposeOther || data.proposedWell.purpose);
      break;
  }
  
  // Work Type
  switch (data.proposedWell.workType) {
    case 'new':
      setCheckBox('New Well', true);
      break;
    case 'reconstruction':
      setCheckBox('Reconstruction', true);
      break;
    case 'destruction':
      setCheckBox('Destruction', true);
      break;
  }
  
  // Well Specs
  setTextField('Proposed Depth of Well feet', data.proposedWell.depth);
  setTextField('Borehole Diameter in', data.proposedWell.boreholeDiameter);
  
  if (data.proposedWell.casingDiameter) {
    setTextField('Diameter in', data.proposedWell.casingDiameter);
  }
  
  if (data.proposedWell.drillingMethod) {
    setTextField('Drilling Equipment', data.proposedWell.drillingMethod);
  }
  
  // Date
  const today = new Date().toLocaleDateString('en-US');
  setTextField('DATED', today);
  setTextField('Date', today);
}

/**
 * Fill Riverside County Well Permit Application
 */
async function fillRiversidePermit(pdfDoc: PDFDocument, data: PermitRequest): Promise<void> {
  const form = pdfDoc.getForm();
  
  const setTextField = (name: string, value: string | undefined) => {
    try {
      if (value) {
        const field = form.getTextField(name);
        field.setText(value);
      }
    } catch (e) {
      console.warn(`Field not found: ${name}`);
    }
  };
  
  const setCheckBox = (name: string, checked: boolean) => {
    try {
      if (checked) {
        const field = form.getCheckBox(name);
        field.check();
      }
    } catch (e) {
      console.warn(`Checkbox not found: ${name}`);
    }
  };
  
  // Well Location
  setTextField('APN', data.property.apn);
  setTextField('Well APN', data.property.apn);
  setTextField('Site Name', data.owner.name);
  setTextField('Street Address', data.property.siteAddress);
  setTextField('City', data.property.city);
  setTextField('Zip Code', data.property.zip);
  setTextField('Latitude', data.property.latitude);
  setTextField('Longitude', data.property.longitude);
  
  // Property Owner
  setTextField('Name_3', data.owner.name);
  setTextField('Mailing Address', data.owner.address);
  setTextField('City_3', data.owner.city);
  setTextField('State', data.owner.state);
  setTextField('Zip Code_3', data.owner.zip);
  setTextField('Phone_3', data.owner.phone);
  setTextField('Email_3', data.owner.email);
  
  // Well Contractor (SCWS)
  setTextField('Name_4', SCWS_INFO.name);
  setTextField('Riverside County Registration No', ''); // They may have a separate registration
  setTextField('C57 License No', SCWS_INFO.license);
  setTextField('Phone_4', SCWS_INFO.phone);
  setTextField('Email_4', SCWS_INFO.email);
  
  // Company Info
  setTextField('Company Name', SCWS_INFO.name);
  setTextField('Contact', SCWS_INFO.contact);
  setTextField('Mailing Address_2', SCWS_INFO.address);
  setTextField('City_4', SCWS_INFO.city);
  setTextField('Zip Code_4', SCWS_INFO.zip);
  setTextField('Phone_5', SCWS_INFO.phone);
  setTextField('Email_5', SCWS_INFO.email);
  
  // Work Type
  switch (data.proposedWell.workType) {
    case 'new':
      setCheckBox('Well Installation', true);
      break;
    case 'reconstruction':
      setCheckBox('Well Reconstruction', true);
      break;
    case 'destruction':
      setCheckBox('Well Destruction', true);
      break;
  }
  
  // Well Specs
  setTextField('Depth', data.proposedWell.depth);
  setTextField('Depth of Boring', data.proposedWell.depth);
  setTextField('Bore Diameter', data.proposedWell.boreholeDiameter);
  setTextField('Diameter', data.proposedWell.casingDiameter || data.proposedWell.boreholeDiameter);
  
  if (data.proposedWell.screenFrom && data.proposedWell.screenTo) {
    setTextField('From ftPerforation', data.proposedWell.screenFrom);
    setTextField('To ftPerforation', data.proposedWell.screenTo);
  }
  
  // Dates
  const today = new Date().toLocaleDateString('en-US');
  setTextField('Date', today);
  setTextField('Date_2', today);
}

/**
 * POST /api/permits/generate-pdf
 * Generate a filled well permit application PDF
 */
export async function POST(request: NextRequest) {
  try {
    const data: PermitRequest = await request.json();
    
    // Validate required fields
    if (!data.county || !data.owner || !data.property || !data.proposedWell) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Load the appropriate PDF template
    const formPath =
      data.county === 'san_diego'
        ? path.join(process.cwd(), 'public', 'forms', 'san-diego-well-permit.pdf')
        : data.county === 'san_bernardino'
          ? path.join(process.cwd(), 'public', 'forms', 'san-bernardino-well-permit.pdf')
          : path.join(process.cwd(), 'public', 'forms', 'riverside-well-permit.pdf');
    
    let pdfBytes: Buffer;
    try {
      pdfBytes = fs.readFileSync(formPath);
    } catch (e) {
      return NextResponse.json(
        { error: `Permit form not found for ${data.county} county` },
        { status: 404 }
      );
    }
    
    // Load and fill the PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    if (data.county === 'san_diego') {
      await fillSanDiegoPermit(pdfDoc, data);
    } else if (data.county === 'riverside') {
      await fillRiversidePermit(pdfDoc, data);
    }
    // San Bernardino: serve the official blank. Do not invent field mappings.
    
    // Flatten form fields (optional - makes it non-editable)
    // pdfDoc.getForm().flatten();
    
    // Generate the filled PDF
    const filledPdfBytes = await pdfDoc.save();
    
    // Return as downloadable PDF
    const filename = `well-permit-${data.county}-${data.property.apn.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}.pdf`;
    
    return new NextResponse(Buffer.from(filledPdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate permit PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
