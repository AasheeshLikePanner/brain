'use client'
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/authContext';
import { getProactiveAlerts } from '@/api/home/api';
import { Button } from '@/components/ui/button';

interface ProactiveAlertsProps {
  onReplySelected: (content: string) => void;
}

export function ProactiveAlerts({ onReplySelected }: ProactiveAlertsProps) {
  const { isAuthenticated } = useAuth();
  const [proactiveData, setProactiveData] = useState<{ alerts: any[], formatted: string, count: number } | null>(null);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [expandedAlerts, setExpandedAlerts] = useState<boolean[]>([]);
  const [selectedAlertIndex, setSelectedAlertIndex] = useState<number | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      const fetchAlerts = async () => {
        setLoadingAlerts(true);
        try {
          const data = await getProactiveAlerts();
          setProactiveData(data);
          setExpandedAlerts(new Array(data.alerts.length).fill(false));
          console.log('Proactive Alerts Data:', data);
        } catch (error) {
          console.error('Failed to fetch proactive alerts:', error);
        } finally {
          setLoadingAlerts(false);
        }
      };
      fetchAlerts();
    } else {
      setProactiveData(null);
      setLoadingAlerts(false);
      setExpandedAlerts([]);
      setSelectedAlertIndex(null);
    }
  }, [isAuthenticated]);

  const toggleExpand = (index: number) => {
    setExpandedAlerts(prev => {
      const newExpanded = [...prev];
      newExpanded[index] = !newExpanded[index];
      return newExpanded;
    });
    setSelectedAlertIndex(prevIndex => (prevIndex === index ? null : index));
  };

  const handleReply = useCallback((content: string) => {
    onReplySelected(content);
    setSelectedAlertIndex(null); // Clear selection after replying
    setExpandedAlerts(prev => prev.map(() => false)); // Collapse all alerts
  }, [onReplySelected]);

  if (!isAuthenticated || (loadingAlerts && !proactiveData)) {
    return null; // Or a loading spinner if preferred
  }

  return (
    <div className="w-full max-w-md mb-4 space-y-2">
      {loadingAlerts && isAuthenticated ? (
        <p className="mb-4">Loading proactive insights...</p>
      ) : (
        proactiveData?.alerts && proactiveData.alerts.length > 0 && (
          <>
            {proactiveData.alerts.map((alert, index) => (
              <div
                key={index}
                className="p-3 bg-card rounded-2xl shadow-md text-left border-2 border-border cursor-pointer"
                onClick={() => toggleExpand(index)}
              >
                <p className={`transition-all duration-300 ease-in-out overflow-hidden ${expandedAlerts[index] ? 'max-h-96' : 'max-h-6'}`}>
                  {alert.content}
                </p>
                {selectedAlertIndex === index && (
                  <div className="mt-2 flex justify-end">
                    <Button onClick={(e) => {
                      e.stopPropagation(); // Prevent toggleExpand from firing again
                      handleReply(alert.content);
                    }} className="rounded-full">
                      Reply
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </>
        )
      )}
    </div>
  );
}
