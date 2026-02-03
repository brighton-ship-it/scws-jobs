'use client'

import { useState, useEffect, useCallback } from 'react'
import * as api from '@/lib/api/marketing'
import type { Campaign, Template, Segment } from '@/lib/api/marketing'

// Hook for campaigns
export function useCampaigns(params?: { status?: string; type?: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { campaigns } = await api.getCampaigns(params)
      setCampaigns(campaigns || [])
    } catch (err) {
      console.error('Error fetching campaigns:', err)
      setError('Failed to load campaigns')
      setCampaigns([])
    } finally {
      setLoading(false)
    }
  }, [params?.status, params?.type])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  return { campaigns, loading, error, refetch: fetchCampaigns }
}

// Hook for templates
export function useTemplates(params?: { type?: string; category?: string }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { templates } = await api.getTemplates(params)
      setTemplates(templates || [])
    } catch (err) {
      console.error('Error fetching templates:', err)
      setError('Failed to load templates')
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [params?.type, params?.category])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  return { templates, loading, error, refetch: fetchTemplates }
}

// Hook for segments
export function useSegments(params?: { type?: string }) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSegments = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { segments } = await api.getSegments(params)
      setSegments(segments || [])
    } catch (err) {
      console.error('Error fetching segments:', err)
      setError('Failed to load segments')
      setSegments([])
    } finally {
      setLoading(false)
    }
  }, [params?.type])

  useEffect(() => {
    fetchSegments()
  }, [fetchSegments])

  return { segments, loading, error, refetch: fetchSegments }
}

// Hook for campaign stats
export function useCampaignStats() {
  const { campaigns, loading, error } = useCampaigns()
  const stats = api.calculateCampaignStats(campaigns)
  return { stats, loading, error }
}
