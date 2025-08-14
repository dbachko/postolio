import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import RegenerationDialog from '../components/RegenerationDialog'
import RegenerationProgress from '../components/RegenerationProgress'
import ConcurrentEditWarning from '../components/ConcurrentEditWarning'

interface UseCampaignEditProps {
  campaignId: string
  existingCampaign: any
  onEditComplete?: () => void
}

interface EditData {
  name?: string
  themes?: string[]
  style?: string
  frequency?: string
  postingTime?: string
  endDate?: string
  priority?: number
}

export function useCampaignEdit({ 
  campaignId, 
  existingCampaign,
  onEditComplete 
}: UseCampaignEditProps) {
  const queryClient = useQueryClient()
  
  // Dialog states
  const [showRegenerationDialog, setShowRegenerationDialog] = useState(false)
  const [showProgressDialog, setShowProgressDialog] = useState(false)
  const [showConcurrentWarning, setShowConcurrentWarning] = useState(false)
  
  // Regeneration state
  const [regenerationJobId, setRegenerationJobId] = useState<string | null>(null)
  const [changedFields, setChangedFields] = useState<{ themes?: string[], style?: string }>({})
  
  // Check for concurrent edits on mount
  useEffect(() => {
    if (existingCampaign?.lastModifiedAt) {
      const lastModified = new Date(existingCampaign.lastModifiedAt)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      
      if (lastModified > fiveMinutesAgo && existingCampaign.lastModifiedBy !== localStorage.getItem('userId')) {
        setShowConcurrentWarning(true)
      }
    }
  }, [existingCampaign])
  
  // Update campaign mutation
  const updateCampaignMutation = useMutation({
    mutationFn: async (data: EditData) => {
      return apiClient.updateCampaign(campaignId, data)
    },
    onSuccess: (_response, variables) => {
      // Check if regeneration is needed based on what fields changed
      const themesChanged = variables.themes && JSON.stringify(variables.themes) !== JSON.stringify(existingCampaign?.config?.themes)
      const styleChanged = variables.style && variables.style !== existingCampaign?.config?.style
      
      if ((themesChanged || styleChanged) && existingCampaign?.content?.length > 0) {
        setChangedFields({
          themes: themesChanged ? variables.themes : undefined,
          style: styleChanged ? variables.style : undefined
        })
        setShowRegenerationDialog(true)
      } else {
        // No regeneration needed, just update cache and complete
        queryClient.invalidateQueries({ queryKey: ['campaigns'] })
        queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] })
        onEditComplete?.()
      }
    }
  })
  
  // Start regeneration mutation
  const startRegenerationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.regenerateContent(campaignId, {
        themes: changedFields.themes,
        style: changedFields.style
      })
      return response
    },
    onSuccess: (response) => {
      setRegenerationJobId(response.data.jobId)
      setShowRegenerationDialog(false)
      setShowProgressDialog(true)
    }
  })
  
  // Handle edit submission
  const handleEditSubmit = useCallback((editData: EditData) => {
    // Always update the campaign - the mutation will handle regeneration check
    updateCampaignMutation.mutate(editData)
  }, [updateCampaignMutation])
  
  // Handle regeneration confirmation
  const handleRegenerationConfirm = useCallback(() => {
    startRegenerationMutation.mutate()
  }, [startRegenerationMutation])
  
  // Handle regeneration complete
  const handleRegenerationComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] })
    setTimeout(() => {
      setShowProgressDialog(false)
      onEditComplete?.()
    }, 1500)
  }, [campaignId, queryClient, onEditComplete])
  
  // Handle concurrent edit warning actions
  const handleRefresh = useCallback(() => {
    window.location.reload()
  }, [])
  
  const handleContinueAnyway = useCallback(() => {
    setShowConcurrentWarning(false)
  }, [])
  
  return {
    // States
    isUpdating: updateCampaignMutation.isPending,
    isRegenerating: startRegenerationMutation.isPending,
    updateError: updateCampaignMutation.error,
    
    // Actions
    handleEditSubmit,
    
    // Dialog components (to be rendered in parent)
    dialogs: (
      <>
        {/* Concurrent Edit Warning */}
        <ConcurrentEditWarning
          isOpen={showConcurrentWarning}
          onClose={() => setShowConcurrentWarning(false)}
          onRefresh={handleRefresh}
          onContinue={handleContinueAnyway}
          lastModifiedAt={existingCampaign?.lastModifiedAt}
          lastModifiedBy={existingCampaign?.lastModifiedBy}
        />
        
        {/* Regeneration Confirmation */}
        <RegenerationDialog
          isOpen={showRegenerationDialog}
          onClose={() => setShowRegenerationDialog(false)}
          onConfirm={handleRegenerationConfirm}
          isConfirming={startRegenerationMutation.isPending}
          contentCount={existingCampaign?.content?.length || 0}
          estimatedTime={Math.ceil((existingCampaign?.content?.length || 0) * 7.5)}
          changedFields={changedFields}
        />
        
        {/* Regeneration Progress */}
        <RegenerationProgress
          isOpen={showProgressDialog}
          onClose={() => setShowProgressDialog(false)}
          jobId={regenerationJobId}
          totalContent={existingCampaign?.content?.length || 0}
          onComplete={handleRegenerationComplete}
        />
      </>
    )
  }
}