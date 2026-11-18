import {useState, useCallback} from 'react';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {
  faArrowRight,
  faArrowLeft,
  faBolt,
  faFileImage,
  faMusic,
  faVideo,
  faRocket,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
import {useTranslation} from 'react-i18next';

const ONBOARDING_COMPLETE_KEY = 'biolaris-onboarding-complete';

export function isOnboardingComplete(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markOnboardingComplete() {
  try {
    window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  } catch {
    // Onboarding state not persisted
  }
}

type Step = {
  icon: typeof faRocket;
  titleKey: string;
  descriptionKey: string;
  features: string[];
};

export function OnboardingScreen({onComplete}: {onComplete: () => void}) {
  const {t} = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);

  const steps: Step[] = [
    {
      icon: faRocket,
      titleKey: 'onboarding.welcome.title' as any,
      descriptionKey: 'onboarding.welcome.description' as any,
      features: [
        'onboarding.welcome.feature1' as any,
        'onboarding.welcome.feature2' as any,
        'onboarding.welcome.feature3' as any,
      ],
    },
    {
      icon: faFileImage,
      titleKey: 'onboarding.convert.title' as any,
      descriptionKey: 'onboarding.convert.description' as any,
      features: [
        'onboarding.convert.feature1' as any,
        'onboarding.convert.feature2' as any,
        'onboarding.convert.feature3' as any,
      ],
    },
    {
      icon: faMusic,
      titleKey: 'onboarding.audio.title' as any,
      descriptionKey: 'onboarding.audio.description' as any,
      features: [
        'onboarding.audio.feature1' as any,
        'onboarding.audio.feature2' as any,
        'onboarding.audio.feature3' as any,
      ],
    },
    {
      icon: faVideo,
      titleKey: 'onboarding.video.title' as any,
      descriptionKey: 'onboarding.video.description' as any,
      features: [
        'onboarding.video.feature1' as any,
        'onboarding.video.feature2' as any,
        'onboarding.video.feature3' as any,
      ],
    },
    {
      icon: faBolt,
      titleKey: 'onboarding.ready.title' as any,
      descriptionKey: 'onboarding.ready.description' as any,
      features: [
        'onboarding.ready.feature1' as any,
        'onboarding.ready.feature2' as any,
        'onboarding.ready.feature3' as any,
      ],
    },
  ];

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      markOnboardingComplete();
      onComplete();
    }
  }, [currentStep, steps.length, onComplete]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-6">
      <div className="w-full max-w-2xl">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
            <span>{t('onboarding.step', {current: currentStep + 1, total: steps.length})}</span>
            <button
              onClick={onComplete}
              className="text-violet-400 transition hover:text-violet-300"
              title={t('onboarding.skip')}
            >
              {t('onboarding.skip')}
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500 ease-out"
              style={{width: `${((currentStep + 1) / steps.length) * 100}%`}}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-8 backdrop-blur-sm">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/20 to-violet-400/10 ring-1 ring-violet-500/30">
              <FontAwesomeIcon icon={step.icon} className="h-10 w-10 text-violet-400" />
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-3 text-center text-2xl font-bold text-zinc-50">
            {t(step.titleKey as any)}
          </h1>

          {/* Description */}
          <p className="mb-6 text-center text-base text-zinc-400">
            {t(step.descriptionKey as any)}
          </p>

          {/* Features list */}
          <ul className="space-y-3">
            {step.features.map((featureKey, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20">
                  <FontAwesomeIcon icon={faCheck} className="h-3 w-3 text-violet-400" />
                </div>
                <span className="text-sm text-zinc-300">{t(featureKey as any)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={prevStep}
            disabled={currentStep === 0}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-zinc-400 transition disabled:opacity-30 disabled:hover:text-zinc-400 hover:text-zinc-200"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="h-4 w-4" />
            {t('onboarding.back')}
          </button>

          <button
            onClick={nextStep}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:from-violet-500 hover:to-violet-400"
          >
            {isLastStep ? t('onboarding.getStarted') : t('onboarding.next')}
            <FontAwesomeIcon icon={isLastStep ? faRocket : faArrowRight} className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
