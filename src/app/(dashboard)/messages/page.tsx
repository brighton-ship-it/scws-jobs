'use client'

import { useState, useRef, useEffect } from 'react'
import { 
  Search, 
  Send,
  Phone,
  User,
  Clock,
  Check,
  CheckCheck,
  MoreVertical,
  Archive,
  Trash2,
  ChevronLeft
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'

// Mock conversations
const mockConversations = [
  {
    id: '1',
    customer_name: 'Robert Johnson',
    phone_number: '+17605551234',
    last_message: 'Thanks! See you tomorrow at 9am.',
    last_message_at: '2026-02-02T18:30:00',
    last_message_direction: 'inbound',
    unread_count: 1,
    status: 'active',
  },
  {
    id: '2',
    customer_name: 'Maria Garcia',
    phone_number: '+17605555678',
    last_message: 'Your technician is on the way! ETA 15 minutes.',
    last_message_at: '2026-02-02T14:15:00',
    last_message_direction: 'outbound',
    unread_count: 0,
    status: 'active',
  },
  {
    id: '3',
    customer_name: 'Desert Oasis HOA',
    phone_number: '+17605559012',
    last_message: 'Can you come check the pump? Its making a weird noise',
    last_message_at: '2026-02-02T11:00:00',
    last_message_direction: 'inbound',
    unread_count: 2,
    status: 'active',
  },
  {
    id: '4',
    customer_name: 'James Wilson',
    phone_number: '+17605553456',
    last_message: 'Quote sent! Let me know if you have questions.',
    last_message_at: '2026-02-01T16:45:00',
    last_message_direction: 'outbound',
    unread_count: 0,
    status: 'active',
  },
]

// Mock messages for selected conversation
const mockMessages = [
  {
    id: '1',
    direction: 'inbound',
    body: 'Hi, my well pump stopped working this morning. No water at all.',
    sent_at: '2026-02-02T08:15:00',
    status: 'delivered',
  },
  {
    id: '2',
    direction: 'outbound',
    body: 'Hi Robert! Sorry to hear that. Can you tell me if the pressure gauge shows any reading?',
    sent_at: '2026-02-02T08:20:00',
    status: 'delivered',
  },
  {
    id: '3',
    direction: 'inbound',
    body: 'The gauge shows 0. And I can hear a clicking sound from the pressure switch.',
    sent_at: '2026-02-02T08:25:00',
    status: 'delivered',
  },
  {
    id: '4',
    direction: 'outbound',
    body: 'That clicking sound suggests the pressure switch is trying to turn on the pump but it\'s not responding. We can send a tech out today. Would 9am tomorrow work?',
    sent_at: '2026-02-02T08:30:00',
    status: 'delivered',
  },
  {
    id: '5',
    direction: 'inbound',
    body: 'Yes 9am works great. Thank you!',
    sent_at: '2026-02-02T08:35:00',
    status: 'delivered',
  },
  {
    id: '6',
    direction: 'outbound',
    body: 'Perfect! I\'ve scheduled Travis to come out at 9am tomorrow. He\'ll call when he\'s on the way. Is 760-555-1234 the best number?',
    sent_at: '2026-02-02T08:40:00',
    status: 'delivered',
  },
  {
    id: '7',
    direction: 'inbound',
    body: 'Thanks! See you tomorrow at 9am.',
    sent_at: '2026-02-02T18:30:00',
    status: 'delivered',
  },
]

function formatTime(dateString: string) {
  const date = new Date(dateString)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

function formatMessageTime(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function MessagesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedConversation, setSelectedConversation] = useState<string | null>('1')
  const [newMessage, setNewMessage] = useState('')
  const [isMobileConversationOpen, setIsMobileConversationOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const filteredConversations = mockConversations.filter(conv =>
    conv.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.phone_number.includes(searchQuery)
  )

  const selectedConv = mockConversations.find(c => c.id === selectedConversation)

  const handleSend = () => {
    if (!newMessage.trim()) return
    // TODO: Send via Twilio API
    console.log('Sending:', newMessage)
    setNewMessage('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const selectConversation = (id: string) => {
    setSelectedConversation(id)
    setIsMobileConversationOpen(true)
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedConversation])

  return (
    <div className="flex-1 flex h-[calc(100vh-4rem)]">
      {/* Conversations List */}
      <div className={`w-full md:w-80 lg:w-96 border-r flex flex-col bg-white ${isMobileConversationOpen ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold mb-3">Messages</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                selectedConversation === conv.id ? 'bg-muted' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{conv.customer_name}</span>
                      {conv.unread_count > 0 && (
                        <Badge className="bg-primary text-white h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate max-w-[180px]">
                      {conv.last_message_direction === 'outbound' && (
                        <CheckCheck className="inline h-3 w-3 mr-1" />
                      )}
                      {conv.last_message}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatTime(conv.last_message_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Message Thread */}
      <div className={`flex-1 flex flex-col bg-gray-50 ${!isMobileConversationOpen ? 'hidden md:flex' : 'flex'}`}>
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="p-4 border-b bg-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="md:hidden"
                  onClick={() => setIsMobileConversationOpen(false)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold">{selectedConv.customer_name}</h2>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {selectedConv.phone_number}
                  </div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>View Customer</DropdownMenuItem>
                  <DropdownMenuItem>Create Job</DropdownMenuItem>
                  <DropdownMenuItem>
                    <Archive className="mr-2 h-4 w-4" />
                    Archive Conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {mockMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-lg p-3 ${
                      msg.direction === 'outbound'
                        ? 'bg-primary text-white'
                        : 'bg-white border'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                    <div className={`flex items-center justify-end gap-1 mt-1 text-xs ${
                      msg.direction === 'outbound' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    }`}>
                      <span>{formatMessageTime(msg.sent_at)}</span>
                      {msg.direction === 'outbound' && (
                        <CheckCheck className="h-3 w-3" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 bg-white border-t">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleKeyPress}
                  rows={1}
                  className="min-h-[40px] max-h-[120px] resize-none"
                />
                <Button onClick={handleSend} disabled={!newMessage.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  )
}
