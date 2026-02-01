'use client';


import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { Button } from '@/components/forms/Button';
import { Badge } from '@/components/ui/Badge';
import { 
  CreditCard, 
  FileSpreadsheet, 
  Calendar, 
  MapPin,
  MessageSquare,
  Mail,
  Check,
  ExternalLink,
} from 'lucide-react';

const integrations = [
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Accept credit card payments online',
    icon: CreditCard,
    color: 'bg-purple-100 text-purple-600',
    connected: false,
    comingSoon: false,
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'Sync invoices and customers to QuickBooks Online',
    icon: FileSpreadsheet,
    color: 'bg-green-100 text-green-600',
    connected: false,
    comingSoon: true,
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Sync job schedule to Google Calendar',
    icon: Calendar,
    color: 'bg-blue-100 text-blue-600',
    connected: false,
    comingSoon: true,
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: 'Address autocomplete and route optimization',
    icon: MapPin,
    color: 'bg-red-100 text-red-600',
    connected: true,
    comingSoon: false,
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'Send SMS notifications to customers',
    icon: MessageSquare,
    color: 'bg-orange-100 text-orange-600',
    connected: false,
    comingSoon: true,
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Send email notifications and invoices',
    icon: Mail,
    color: 'bg-cyan-100 text-cyan-600',
    connected: false,
    comingSoon: true,
  },
];

export default function IntegrationsSettingsPage() {
  const handleConnect = (id: string) => {
    alert(`Connecting to ${id}...`);
  };

  const handleDisconnect = (id: string) => {
    alert(`Disconnecting from ${id}...`);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations' },
        ]}
      />

      <div>
        <h2 className="text-2xl font-bold text-gray-900">Integrations</h2>
        <p className="text-gray-600">Connect third-party services to extend functionality</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {integrations.map((integration) => (
          <Card key={integration.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <div className={`rounded-lg p-3 ${integration.color}`}>
                  <integration.icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{integration.name}</h3>
                    {integration.connected && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <Check className="h-3 w-3" />
                        Connected
                      </span>
                    )}
                    {integration.comingSoon && (
                      <Badge variant="secondary">Coming Soon</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{integration.description}</p>
                  <div className="mt-3">
                    {integration.comingSoon ? (
                      <Button variant="outline" size="sm" disabled>
                        Coming Soon
                      </Button>
                    ) : integration.connected ? (
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Configure
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDisconnect(integration.id)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        variant="primary" 
                        size="sm"
                        onClick={() => handleConnect(integration.id)}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* API Access */}
      <Card>
        <CardHeader>
          <CardTitle>API Access</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Use our API to build custom integrations with your existing tools.
          </p>
          <div className="rounded-lg bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">API Key</p>
                <p className="text-xs text-gray-500 font-mono">sk_live_************************</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  Show Key
                </Button>
                <Button variant="outline" size="sm">
                  Regenerate
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Button variant="outline" href="https://docs.example.com" target="_blank">
              <ExternalLink className="h-4 w-4 mr-2" />
              View API Documentation
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
