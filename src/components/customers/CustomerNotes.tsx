'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Plus, Trash2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

interface Note {
  id: string;
  note: string;
  created_by: string;
  created_at: string;
}

interface CustomerNotesProps {
  customerId: string;
}

export default function CustomerNotes({ customerId }: CustomerNotesProps) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, [customerId]);

  const fetchNotes = async () => {
    try {
      const res = await fetch(`/api/customers/${customerId}/notes`);
      if (res.ok) {
        const data = await res.json();
        setNotes(data.notes || []);
      }
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    
    setSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: newNote,
          created_by: user?.email || user?.name || 'Unknown'
        })
      });
      
      if (res.ok) {
        const data = await res.json();
        setNotes([data.note, ...notes]);
        setNewNote('');
        setShowForm(false);
      }
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!confirm('Delete this note?')) return;
    
    try {
      const res = await fetch(`/api/customers/${customerId}/notes?noteId=${noteId}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        setNotes(notes.filter(n => n.id !== noteId));
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Notes ({notes.length})
        </CardTitle>
        <Button 
          size="sm" 
          onClick={() => setShowForm(!showForm)}
          variant={showForm ? "secondary" : "default"}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Note
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Note Form */}
        {showForm && (
          <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
            <Textarea
              placeholder="Type your note here..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  setNewNote('');
                }}
              >
                Cancel
              </Button>
              <Button 
                size="sm"
                onClick={addNote}
                disabled={!newNote.trim() || submitting}
              >
                <Send className="h-4 w-4 mr-1" />
                {submitting ? 'Saving...' : 'Save Note'}
              </Button>
            </div>
          </div>
        )}

        {/* Notes List */}
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">Loading notes...</div>
        ) : notes.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No notes yet. Click "Add Note" to create one.
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <div 
                key={note.id} 
                className="p-3 border rounded-lg bg-background hover:bg-muted/30 transition-colors"
              >
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm whitespace-pre-wrap flex-1">{note.note}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteNote(note.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="mt-2 text-xs text-muted-foreground flex items-center gap-2">
                  <span>{note.created_by}</span>
                  <span>·</span>
                  <span>{format(new Date(note.created_at), 'MMM d, yyyy h:mm a')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
