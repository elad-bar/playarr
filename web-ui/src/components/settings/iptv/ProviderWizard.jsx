import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SaveIcon from '@mui/icons-material/Save';
import BasicDetailsStep from './steps/BasicDetailsStep';
import ProviderDetailsStep from './steps/ProviderDetailsStep';
import CleanupRulesStep from './steps/CleanupRulesStep';
import CategoriesStep from './steps/CategoriesStep';
import IgnoredTitlesStep from './steps/IgnoredTitlesStep';
import BasicDetailsPreview from './steps/previews/BasicDetailsPreview';
import ProviderDetailsPreview from './steps/previews/ProviderDetailsPreview';
import CleanupRulesPreview from './steps/previews/CleanupRulesPreview';
import CategoriesPreview from './steps/previews/CategoriesPreview';
import IgnoredTitlesPreview from './steps/previews/IgnoredTitlesPreview';
import { saveIPTVProvider } from './utils';

// Import ProviderDetailsStep to access static validation function
// This is needed for credential validation

/**
 * ProviderWizard - Main wizard component for adding/editing IPTV providers
 * @param {Object|null} provider - Provider object (null for add mode)
 * @param {Function} onSave - Callback when provider is saved
 * @param {Function} onCancel - Callback when wizard is cancelled
 * @param {Function} onSaveAndClose - Callback when provider is saved and wizard should close
 */
function ProviderWizard({ provider, onSave, onCancel, onSaveAndClose }) {

  const isAddMode = !provider;
  const [isAddModeState, setIsAddModeState] = useState(isAddMode);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [stepData, setStepData] = useState({});
  const [validationErrors, setValidationErrors] = useState({});
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentProvider, setCurrentProvider] = useState(provider);
  const [savedStepData, setSavedStepData] = useState({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Update current provider when prop changes and initialize step data
  useEffect(() => {
    setCurrentProvider(provider);
    setIsAddModeState(!provider);
    
    // Initialize step data from provider in edit mode
    if (provider && !isAddMode) {
      const urls = provider.streams_urls || [];
      const apiUrlIndex = provider.api_url && urls.length > 0
        ? urls.findIndex(url => url === provider.api_url)
        : 0;
      
      setStepData({
        0: { // Provider Details
          urls,
          apiUrlIndex: apiUrlIndex >= 0 ? apiUrlIndex : 0,
          username: provider.username || '',
          password: provider.password || '',
        },
        1: { // Cleanup Rules
          cleanup: provider.cleanup || {},
        },
        2: { // Categories
          enabled_categories: provider.enabled_categories || { movies: [], tvshows: [] },
        },
      });
    } else {
      // Reset step data in add mode
      setStepData({});
    }
    
    // Reset to first step
    setCurrentStep(0);
    setCompletedSteps(new Set());
    setValidationErrors({});
    setHasUnsavedChanges(false);
    
    // Initialize saved step data for dirty tracking
    if (provider && !isAddMode) {
      const urls = provider.streams_urls || [];
      const apiUrlIndex = provider.api_url && urls.length > 0
        ? urls.findIndex(url => url === provider.api_url)
        : 0;
      
      setSavedStepData({
        0: {
          urls,
          apiUrlIndex: apiUrlIndex >= 0 ? apiUrlIndex : 0,
          username: provider.username || '',
          password: provider.password || '',
        },
        1: {
          cleanup: provider.cleanup || {},
        },
        2: {
          enabled_categories: provider.enabled_categories || { movies: [], tvshows: [] },
        },
      });
    } else {
      setSavedStepData({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Define steps based on mode and provider type
  const getSteps = useCallback(() => {
    const providerType = stepData[0]?.type || currentProvider?.type?.toLowerCase() || 'xtream';
    const isXtream = providerType === 'xtream';

    if (isAddModeState) {
      // Add mode steps
      const steps = [
        { id: 'basic-details', label: 'Basic Details' },
        { id: 'provider-details', label: 'Provider Details' },
      ];
      if (isXtream) {
        steps.push(
          { id: 'cleanup-rules', label: 'Cleanup Rules' },
          { id: 'categories', label: 'Categories' }
        );
      }
      return steps;
    } else {
      // Edit mode steps
      const steps = [
        { id: 'provider-details', label: 'Provider Details' },
      ];
      if (isXtream) {
        steps.push(
          { id: 'cleanup-rules', label: 'Cleanup Rules' },
          { id: 'categories', label: 'Categories' }
        );
      }
      steps.push({ id: 'ignored-titles', label: 'Ignored Titles' });
      return steps;
    }
  }, [isAddModeState, stepData, currentProvider]);

  const steps = getSteps();

  // Check if step has unsaved changes
  const checkStepHasChanges = useCallback((stepIndex) => {
    if (isAddModeState) {
      // In add mode, any data means changes
      return Object.keys(stepData[stepIndex] || {}).length > 0;
    }
    
    // In edit mode, compare with saved data
    const currentData = stepData[stepIndex] || {};
    const savedData = savedStepData[stepIndex] || {};
    
    return JSON.stringify(currentData) !== JSON.stringify(savedData);
  }, [stepData, savedStepData, isAddModeState]);

  // Update step data
  const updateStepData = useCallback((stepIndex, data) => {
    setStepData(prev => ({
      ...prev,
      [stepIndex]: data,
    }));
  }, []);
  
  // Track dirty state
  useEffect(() => {
    const hasChanges = checkStepHasChanges(currentStep);
    setHasUnsavedChanges(hasChanges);
  }, [currentStep, stepData, checkStepHasChanges]);

  // Validate step
  const validateStep = useCallback(async (stepIndex) => {
    const step = steps[stepIndex];
    if (!step) return false;

    const stepDataForStep = stepData[stepIndex] || {};
    
    // Basic validation
    if (step.id === 'basic-details') {
      const id = stepDataForStep.id?.trim();
      const type = stepDataForStep.type;
      if (!id || !type) {
        setValidationErrors(prev => ({
          ...prev,
          [stepIndex]: { id: !id ? 'Provider ID is required' : null, type: !type ? 'Provider type is required' : null },
        }));
        return false;
      }
    }

    if (step.id === 'provider-details') {
      const urls = stepDataForStep.urls || [];
      const username = stepDataForStep.username?.trim();
      const password = stepDataForStep.password?.trim();
      
      // Basic field validation
      if (urls.length === 0 || !username || !password) {
        setValidationErrors(prev => ({
          ...prev,
          [stepIndex]: {
            urls: urls.length === 0 ? 'At least one URL is required' : null,
            username: !username ? 'Username is required' : null,
            password: !password ? 'Password is required' : null,
          },
        }));
        return false;
      }

      // Credential validation
      setIsValidating(true);
      try {
        if (ProviderDetailsStep.validateCredentials) {
          const isValid = await ProviderDetailsStep.validateCredentials();
          if (!isValid) {
            setValidationErrors(prev => ({
              ...prev,
              [stepIndex]: {
                ...prev[stepIndex],
                credentials: 'Invalid credentials. Please check your username, password, and API URL.',
              },
            }));
            setIsValidating(false);
            return false;
          }
        }
      } catch (error) {
        setValidationErrors(prev => ({
          ...prev,
          [stepIndex]: {
            ...prev[stepIndex],
            credentials: error.message || 'Failed to validate credentials',
          },
        }));
        setIsValidating(false);
        return false;
      } finally {
        setIsValidating(false);
      }
    }

    // Clear errors if validation passes
    setValidationErrors(prev => ({
      ...prev,
      [stepIndex]: {},
    }));
    return true;
  }, [steps, stepData]);


  // Handle continue
  const handleContinue = useCallback(async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) return;

    // Mark step as completed
    setCompletedSteps(prev => new Set([...prev, currentStep]));

    // Move to next step
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      setHasUnsavedChanges(false);
    }
  }, [currentStep, steps.length, validateStep]);

  // Handle back
  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setHasUnsavedChanges(false);
    }
  }, [currentStep]);

  // Build provider data from step data
  const buildProviderData = useCallback(() => {
    const providerType = stepData[0]?.type || currentProvider?.type?.toLowerCase() || 'xtream';
    const isXtream = providerType === 'xtream';

    let data = {
      ...currentProvider,
    };

    if (isAddModeState) {
      // Add mode: combine step 0 (basic details) and step 1 (provider details)
      const basicDetails = stepData[0] || {};
      const providerDetails = stepData[1] || {};
      
      data = {
        id: basicDetails.id,
        type: basicDetails.type,
        urls: providerDetails.urls || [],
        apiUrlIndex: providerDetails.apiUrlIndex || 0,
        username: providerDetails.username,
        password: providerDetails.password,
        enabled: true,
        cleanup: stepData[2]?.cleanup || {},
        enabled_categories: stepData[3]?.enabled_categories || { movies: [], tvshows: [] },
      };
    } else {
      // Edit mode: combine step 0 (provider details), step 1 (cleanup), step 2 (categories)
      const providerDetails = stepData[0] || {};
      const cleanupRules = stepData[1] || {};
      const categories = stepData[2] || {};
      
      data = {
        ...currentProvider,
        urls: providerDetails.urls || currentProvider?.streams_urls || [],
        apiUrlIndex: providerDetails.apiUrlIndex || 0,
        username: providerDetails.username || currentProvider?.username,
        password: providerDetails.password || currentProvider?.password,
        cleanup: cleanupRules.cleanup || currentProvider?.cleanup || {},
        enabled_categories: categories.enabled_categories || currentProvider?.enabled_categories || { movies: [], tvshows: [] },
      };
    }

    // Convert URLs to streams_urls and api_url format
    const urls = data.urls.filter(url => url.trim() !== '');
    const apiUrlIndex = Math.max(0, Math.min(data.apiUrlIndex || 0, urls.length - 1));
    
    return {
      ...data,
      streams_urls: isXtream ? urls : (urls.length > 0 ? [urls[0]] : []),
      api_url: urls.length > 0 ? urls[apiUrlIndex] : '',
      id: data.id || currentProvider?.id,
      type: data.type || currentProvider?.type,
    };
  }, [stepData, currentProvider, isAddModeState]);

  // Handle save and continue
  const handleSaveAndContinue = useCallback(async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) return;

    setIsSaving(true);
    try {
      // Build provider data from step data
      const providerData = buildProviderData();
      
      const savedProvider = await saveIPTVProvider(providerData, isAddModeState);
      
      // Update local state
      setCurrentProvider(savedProvider);
      
      // If in add mode, switch to edit mode
      if (isAddModeState) {
        setIsAddModeState(false);
      }

      // Mark step as completed
      setCompletedSteps(prev => new Set([...prev, currentStep]));
      
      // Update saved step data
      setSavedStepData(prev => ({
        ...prev,
        [currentStep]: stepData[currentStep] || {},
      }));
      setHasUnsavedChanges(false);

      // Move to next step
      if (currentStep < steps.length - 1) {
        setCurrentStep(currentStep + 1);
      }

      // Call onSave callback
      if (onSave) {
        onSave(savedProvider);
      }
    } catch (error) {
      console.error('Error saving provider:', error);
      // Error handling will be done by step components
    } finally {
      setIsSaving(false);
    }
  }, [currentStep, isAddModeState, steps.length, validateStep, onSave, buildProviderData, stepData]);

  // Handle save (last step only)
  const handleSave = useCallback(async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) return;

    setIsSaving(true);
    try {
      const providerData = buildProviderData();
      const savedProvider = await saveIPTVProvider(providerData, isAddModeState);
      
      setCurrentProvider(savedProvider);
      if (isAddModeState) {
        setIsAddModeState(false);
      }
      
      // Update saved step data
      setSavedStepData(prev => ({
        ...prev,
        [currentStep]: stepData[currentStep] || {},
      }));
      setHasUnsavedChanges(false);

      if (onSave) {
        onSave(savedProvider);
      }
    } catch (error) {
      console.error('Error saving provider:', error);
    } finally {
      setIsSaving(false);
    }
  }, [currentStep, isAddModeState, validateStep, onSave, buildProviderData, stepData]);

  // Handle save and close
  const handleSaveAndClose = useCallback(async () => {
    const isValid = await validateStep(currentStep);
    if (!isValid) return;

    setIsSaving(true);
    try {
      const providerData = buildProviderData();
      const savedProvider = await saveIPTVProvider(providerData, isAddModeState);
      
      // Update saved step data
      setSavedStepData(prev => ({
        ...prev,
        [currentStep]: stepData[currentStep] || {},
      }));
      setHasUnsavedChanges(false);
      
      if (onSaveAndClose) {
        onSaveAndClose(savedProvider);
      }
    } catch (error) {
      console.error('Error saving provider:', error);
    } finally {
      setIsSaving(false);
    }
  }, [currentStep, isAddModeState, validateStep, onSaveAndClose, buildProviderData, stepData]);

  // Handle accordion expansion change
  const handleAccordionChange = useCallback((stepIndex) => (event, isExpanded) => {
    // If collapsing, do nothing (we don't allow manual collapse)
    if (!isExpanded) {
      // Prevent collapse by keeping current step expanded
      return;
    }
    
    // If already expanded, do nothing
    if (stepIndex === currentStep) return;
    
    // In edit mode, allow clicking any step
    // But warn if current step has unsaved changes
    if (!isAddModeState && hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes on this step. Are you sure you want to navigate away? Your changes will be lost.'
      );
      if (!confirmed) {
        // Prevent expansion by not updating currentStep
        return;
      }
    }
    
    setCurrentStep(stepIndex);
    setHasUnsavedChanges(false);
  }, [currentStep, isAddModeState, hasUnsavedChanges]);

  // Render step preview
  const renderStepPreview = (step, stepIndex) => {
    const stepDataForStep = stepData[stepIndex] || {};

    switch (step.id) {
      case 'basic-details':
        return <BasicDetailsPreview data={stepDataForStep} />;
      case 'provider-details':
        return <ProviderDetailsPreview data={stepDataForStep} provider={currentProvider} />;
      case 'cleanup-rules':
        return <CleanupRulesPreview data={stepDataForStep} provider={currentProvider} />;
      case 'categories':
        return <CategoriesPreview data={stepDataForStep} provider={currentProvider} />;
      case 'ignored-titles':
        return <IgnoredTitlesPreview provider={currentProvider} />;
      default:
        return null;
    }
  };

  // Render step content (editor)
  const renderStepContent = (step, stepIndex) => {
    const stepDataForStep = stepData[stepIndex] || {};
    const errors = validationErrors[stepIndex] || {};

    switch (step.id) {
      case 'basic-details':
        return (
          <BasicDetailsStep
            data={stepDataForStep}
            onChange={(data) => updateStepData(stepIndex, data)}
            errors={errors}
            onValidate={validateStep}
          />
        );
      case 'provider-details':
        return (
          <ProviderDetailsStep
            provider={currentProvider}
            isAddMode={isAddModeState}
            data={stepDataForStep}
            onChange={(data) => updateStepData(stepIndex, data)}
            errors={errors}
            onValidate={validateStep}
            isValidating={isValidating}
            setIsValidating={setIsValidating}
          />
        );
      case 'cleanup-rules':
        return (
          <CleanupRulesStep
            provider={currentProvider}
            data={stepDataForStep}
            onChange={(data) => updateStepData(stepIndex, data)}
            onSave={(data) => updateStepData(stepIndex, data)}
          />
        );
      case 'categories':
        return (
          <CategoriesStep
            provider={currentProvider}
            data={stepDataForStep}
            onChange={(data) => updateStepData(stepIndex, data)}
            onSave={(data) => updateStepData(stepIndex, data)}
          />
        );
      case 'ignored-titles':
        return (
          <IgnoredTitlesStep
            provider={currentProvider}
          />
        );
      default:
        return null;
    }
  };

  // Render navigation buttons
  const renderNavigationButtons = (stepIndex) => {
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === steps.length - 1;
    const errors = validationErrors[stepIndex] || {};
    const isValid = Object.values(errors).every(error => !error);

    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pt: 3,
          mt: 2,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Box>
          {!isFirst && (
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={handleBack}
              disabled={isSaving}
              sx={{ minWidth: 120 }}
            >
              Back
            </Button>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 2 }}>
          {!isLast && (
            <>
              <Button
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                onClick={handleContinue}
                disabled={!isValid || isSaving}
                sx={{ minWidth: 140 }}
              >
                Continue
              </Button>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                endIcon={<ArrowForwardIcon />}
                onClick={handleSaveAndContinue}
                disabled={!isValid || isSaving}
                sx={{ minWidth: 180 }}
              >
                Save & Continue
              </Button>
            </>
          )}
          {isLast && (
            <>
              <Button
                variant="outlined"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={!isValid || isSaving}
                sx={{ minWidth: 120 }}
              >
                Save
              </Button>
              <Button
                variant="contained"
                startIcon={<CheckCircleIcon />}
                onClick={handleSaveAndClose}
                disabled={!isValid || isSaving}
                sx={{ minWidth: 160 }}
              >
                Save & Close
              </Button>
            </>
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', p: 2 }}>
      {steps.map((step, index) => {
        const isExpanded = index === currentStep;
        const isCompleted = completedSteps.has(index);
        
        // In add mode, disable steps that haven't been reached yet
        const isDisabled = isAddModeState && index > currentStep && !isCompleted;
        
        // In edit mode, allow clicking any step (unless current step has unsaved changes)
        const canClick = !isAddModeState && !hasUnsavedChanges;

        return (
          <Accordion
            key={step.id}
            expanded={isExpanded}
            onChange={handleAccordionChange(index)}
            disabled={isDisabled && !canClick}
            TransitionProps={{ timeout: 0 }}
            sx={{
              '&:before': {
                display: 'none',
              },
              mb: 1,
              '&.Mui-disabled': {
                opacity: 0.6,
              },
              '& .MuiCollapse-root': {
                transition: 'none !important',
              },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{
                '& .MuiAccordionSummary-content': {
                  alignItems: 'center',
                },
                cursor: isDisabled && !canClick ? 'not-allowed' : 'pointer',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', mr: 2 }}>
                <Typography variant="h6" sx={{ minWidth: 200, fontWeight: isExpanded ? 600 : 400 }}>
                  {index + 1}. {step.label}
                </Typography>
                {!isExpanded && (
                  <Box sx={{ flexGrow: 1 }}>
                    {renderStepPreview(step, index)}
                  </Box>
                )}
                {isCompleted && (
                  <CheckCircleIcon sx={{ color: 'success.main', ml: 'auto' }} />
                )}
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                {renderStepContent(step, index)}
                {renderNavigationButtons(index)}
              </Box>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}

export default ProviderWizard;

