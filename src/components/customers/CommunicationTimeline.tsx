'use client';

import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { 
  MessageSquare, 
  Mail, 
  Phone, 
  StickyNote, 
  Plus,
  Filter,
  X,
  Send,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Communication, CommunicationType, CommunicationDirection } from '@/types/database';

interface CommunicationTimelineProps {
  customerId: string;
  jobId?: string;
}

const typeIcons: Record<CommunicationType, React.ReactNode> = {
  sms: <MessageSquare className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  note: <StickyNote className="h-4 w-4" />,
};

const typeColors: Record<CommunicationType, string> = {
  sms: 'bg-green-100 text-green-600',
  email: 'bg-blue-100 text-blue-600',
  call: 'bg-purple-100 text-purple-600',
  note: 'bg-amber-100 text-amber-600',
};

const typeLabels: Record<CommunicationType, string> = {
  sms: 'SMS',
  email: 'Email',
  call: 'Phone Call',
  note: 'Note',
};

export default function CommunicationTimeline({ customerId, jobId }: CommunicationTimelineProps) {
  const [communications, setCommunications] = useState<(Communication & { sent_by_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<CommunicationType | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'call' | 'note'>('note');
  const [addDirection, setAddDirection] = useState<CommunicationDirection>('outbound');
  const [addContent, setAddContent] = useState('');
  const [addDuration, setAddDuration] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCommunications = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ customerId });
      if (jobId) params.append('jobId', jobId);
      if (filter !== 'all') params.append('type', filter);
      
      const res = await fetch(`/api/communications?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCommunications(data.communications || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch communications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommunications();
  }, [customerId, jobId, filter]);

  const handleAdd = async () => {
    if (!addContent.trim()) return;
    
    setSubmitting(true);
    try {
      const res = await fetch('/api/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          jobId,
          type: addType,
          direction: addDirection,
          content: addContent,
          duration: addDuration ? parseInt(addDuration) : undefined,
        }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setAddContent('');
        setAddDuration('');
        fetchCommunications();
      }
    } catch (err) {
      console.error('Failed to add communication:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-gray-400" />
            Communications
          </CardTitle>
          {total > 0 && (
            <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Filter dropdown */}
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as CommunicationType | 'all')}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 pr-8 appearance-none bg-white cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="all">All Types</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="call">Calls</option>
              <option value="note">Notes</option>
            </select>
            <Filter className="h-4 w-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : communications.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p>No communications yet</p>
            <p className="text-sm">Add a note or log a call to get started</p>
          </div>
        ) : (
          <div className="space-y-4">
            {communications.map((comm) => (
              <div key={comm.id} className="flex gap-3">
                {/* Icon */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${typeColors[comm.type]}`}>
                  {typeIcons[comm.type]}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm">
                      {typeLabels[comm.type]}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                      comm.direction === 'inbound' 
                        ? 'bg-blue-50 text-blue-600' 
                        : 'bg-green-50 text-green-600'
                    }`}>
                      {comm.direction === 'inbound' ? (
                        <><ArrowDownLeft className="h-3 w-3" /> Inbound</>
                      ) : (
                        <><ArrowUpRight className="h-3 w-3" /> Outbound</>
                      )}
                    </span>
                    {comm.subject && (
                      <span className="text-sm text-gray-600 truncate">
                        — {comm.subject}
                      </span>
                    )}
                  </div>
                  
                  <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
                    {comm.body}
                  </p>
                  
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(parseISO(comm.sent_at), 'MMM d, yyyy h:mm a')}
                    </span>
                    {comm.sent_by_name && (
                      <span>by {comm.sent_by_name}</span>
                    )}
                    {comm.metadata?.phone && (
                      <span>{comm.metadata.phone}</span>
                    )}
                    {comm.metadata?.email && (
                      <span>{comm.metadata.email}</span>
                    )}
                    {comm.metadata?.duration && (
                      <span>{comm.metadata.duration} min</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Add Communication Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Add Communication</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 hover:bg-gray-100 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Type selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAddType('note')}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      addType === 'note'
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <StickyNote className="h-4 w-4 inline mr-2" />
                    Note
                  </button>
                  <button
                    onClick={() => setAddType('call')}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      addType === 'call'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Phone className="h-4 w-4 inline mr-2" />
                    Call Log
                  </button>
                </div>
              </div>

              {/* Direction (for calls) */}
              {addType === 'call' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Direction</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAddDirection('inbound')}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                        addDirection === 'inbound'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <ArrowDownLeft className="h-4 w-4 inline mr-2" />
                      Incoming
                    </button>
                    <button
                      onClick={() => setAddDirection('outbound')}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                        addDirection === 'outbound'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <ArrowUpRight className="h-4 w-4 inline mr-2" />
                      Outgoing
                    </button>
                  </div>
                </div>
              )}

              {/* Duration (for calls) */}
              {addType === 'call' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    value={addDuration}
                    onChange={(e) => setAddDuration(e.target.value)}
                    placeholder="e.g. 5"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              )}

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {addType === 'note' ? 'Note' : 'Call Notes'}
                </label>
                <textarea
                  value={addContent}
                  onChange={(e) => setAddContent(e.target.value)}
                  rows={4}
                  placeholder={addType === 'note' ? 'Add a note about this customer...' : 'What was discussed on the call?'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!addContent.trim() || submitting}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
