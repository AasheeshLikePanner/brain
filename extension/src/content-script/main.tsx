import React from 'react';
import { createRoot } from 'react-dom/client';

// Existing Popup component for text selection
const Popup = () => {
  return (
    <div style={{
      position: 'absolute',
      background: 'white',
      border: '1px solid black',
      borderRadius: '5px',
      padding: '10px',
      zIndex: 10000
    }}>
      <button>Save to Brain</button>
    </div>
  );
};

// Existing mouseup event listener for text selection
document.addEventListener('mouseup', (event) => {
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    let popup = document.getElementById('brain-selection-popup');
    if (popup) {
      popup.remove();
    }

    popup = document.createElement('div');
    popup.id = 'brain-selection-popup';
    document.body.appendChild(popup);

    const root = createRoot(popup);
    root.render(<Popup />);

    popup.style.top = `${rect.top + window.scrollY - 50}px`;
    popup.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 50}px`;
  } else {
    const popup = document.getElementById('brain-selection-popup');
    if (popup && event.target !== popup && !popup.contains(event.target as Node)) {
      popup.remove();
    }
  }
});

// Function to inject the icon into a tweet
const injectIconIntoTweet = (tweetElement: HTMLElement) => {
  // Check if the icon is already injected to prevent duplicates
  if (tweetElement.querySelector('.brain-extension-tweet-icon')) {
    return;
  }

  // Find the action bar within the tweet
  const actionBar = tweetElement.querySelector('div[role="group"]');

  if (actionBar) {
    const iconContainer = document.createElement('div');
    iconContainer.className = 'brain-extension-tweet-icon'; // Simplified class for now
    iconContainer.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background-color: #1DA1F2; /* Twitter blue */
      color: white;
      cursor: pointer;
      margin-left: 8px;
      font-size: 12px;
      font-weight: bold;
      z-index: 9999;
    `;
    iconContainer.innerText = 'B'; // Simple 'B' icon for Brain

    // Add click listener to the new button
    iconContainer.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent tweet click event
      const tweetTextElement = tweetElement.querySelector('div[data-testid="tweetText"]');
      const tweetText = tweetTextElement ? tweetTextElement.textContent : 'No text found';
      alert(`Brain Extension: Processing tweet - "${tweetText}"`);
    });

    // Inject the icon container into the action bar
    actionBar.appendChild(iconContainer);
  }
};

// Function to inject the icon into a Gmail email row
const gmailIntervals = new Map<HTMLElement, number>();
const calendarIntervals = new Map<HTMLElement, number>();

const injectMeetingButtonIntoCalendar = (eventDialogElement: HTMLElement) => {
  console.log('Calendar: injectMeetingButtonIntoCalendar called for:', eventDialogElement);

  // Clear any existing interval for this event dialog to prevent duplicates
  if (calendarIntervals.has(eventDialogElement)) {
    clearInterval(calendarIntervals.get(eventDialogElement));
    calendarIntervals.delete(eventDialogElement);
  }

  const injectAndMonitorCalendar = () => {
    // Check if the event dialog is still in the DOM
    if (!document.body.contains(eventDialogElement)) {
      clearInterval(calendarIntervals.get(eventDialogElement));
      calendarIntervals.delete(eventDialogElement);
      console.log('Calendar: Event dialog removed from DOM, stopping monitoring.');
      return;
    }

    let buttonWrapper = eventDialogElement.querySelector('.brain-extension-calendar-button-wrapper') as HTMLElement;
    const topActionBar = eventDialogElement.querySelector('.pPTZAe');

    if (topActionBar) {
      if (!buttonWrapper) {
        console.log('Calendar: Re-injecting Brain It! button into event dialog.');
        // Create a wrapper div to mimic Google's button structure
        buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'brain-extension-calendar-button-wrapper';
        buttonWrapper.style.cssText = `
          /* Mimic the div structure of other buttons */
          display: inline-block;
          margin-left: 8px; /* Add some spacing */
        `;

        const brainButtonSpanWrapper = document.createElement('span');
        brainButtonSpanWrapper.setAttribute('data-is-tooltip-wrapper', 'true');

        const brainButton = document.createElement('button');
        // Attempt to mimic Google Calendar's button styling and classes
        brainButton.className = 'brain-extension-calendar-button pYTkkf-Bz112c-LgbsSe pYTkkf-Bz112c-LgbsSe-OWXEXe-SfQLQb-suEOdc';
        brainButton.style.cssText = `
          background-color: #4285F4; /* Google blue */
          color: white;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 14px;
          cursor: pointer;
          vertical-align: middle;
          display: inline-flex; /* To align content */
          align-items: center;
          justify-content: center;
          height: 36px; /* Standard button height in Google Calendar */
        `;
        brainButton.innerHTML = `
          <span class="OiePBf-zPjgPe pYTkkf-Bz112c-UHGRz"></span>
          <span class="RBHQF-ksKsZd" jscontroller="LBaJxb" jsname="m9ZlFb"></span>
          <span jsname="S5tZuc" aria-hidden="true" class="pYTkkf-Bz112c-kBDsod-Rtc0Jf">
            <span class="notranslate VfPpkd-kBDsod" aria-hidden="true">🧠</span>
          </span>
          <span class="VfPpkd-vQzf8d" aria-hidden="true">Brain It!</span>
          <div class="pYTkkf-Bz112c-RLmnJb"></div>
        `;
        brainButton.setAttribute('data-tooltip', 'Send meeting info to Brain');
        brainButton.setAttribute('aria-label', 'Brain It!');

        brainButton.addEventListener('click', (e) => {
          e.stopPropagation();
          const eventTitleElement = eventDialogElement.querySelector('#rAECCd');
          const eventTitle = eventTitleElement ? eventTitleElement.textContent : 'No event title found';
          const meetLinkElement = eventDialogElement.querySelector('a[href^="https://meet.google.com/"]');
          const meetLink = meetLinkElement ? (meetLinkElement as HTMLAnchorElement).href : 'No Meet link found';
          alert(`Brain Extension: Processing Calendar Event - Title: "${eventTitle}", Meet Link: "${meetLink}"`);
        });

        brainButtonSpanWrapper.appendChild(brainButton);
        buttonWrapper.appendChild(brainButtonSpanWrapper);

        // Append the new button wrapper to the top action bar
        topActionBar.appendChild(buttonWrapper);
        console.log('Calendar: Brain It! button injected into top action bar.');
      }
    } else {
      console.log('Calendar: Top action bar (.pPTZAe) not found.');
    }
  };

  // Initial injection and start monitoring
  injectAndMonitorCalendar();
  const intervalId = setInterval(injectAndMonitorCalendar, 1000); // Check every 1 second
  calendarIntervals.set(eventDialogElement, intervalId);
};

const injectIconIntoGmailEmail = (emailRowElement: HTMLElement) => {
  // Clear any existing interval for this email row to prevent duplicates
  if (gmailIntervals.has(emailRowElement)) {
    clearInterval(gmailIntervals.get(emailRowElement));
    gmailIntervals.delete(emailRowElement);
  }

  const injectAndMonitor = () => {
    // Check if the email row is still in the DOM
    if (!document.body.contains(emailRowElement)) {
      clearInterval(gmailIntervals.get(emailRowElement));
      gmailIntervals.delete(emailRowElement);
      return;
    }

    let iconContainer = emailRowElement.querySelector('.brain-extension-gmail-icon') as HTMLElement;
    const toolbarTd = emailRowElement.querySelector('td.bq4.xY');

    if (toolbarTd) {
      if (!iconContainer) {
        console.log('Gmail: Re-injecting icon into email row:', emailRowElement);
        iconContainer = document.createElement('div');
        iconContainer.className = 'brain-extension-gmail-icon';
        iconContainer.style.cssText = `
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background-color: #DB4437; /* Gmail red */
          color: white;
          cursor: pointer;
          margin-left: 8px;
          font-size: 12px;
          font-weight: bold;
          z-index: 9999;
          vertical-align: middle; /* Align with other elements */
        `;
        iconContainer.innerText = 'B';
        iconContainer.setAttribute('data-tooltip', 'Brain Extension');

        iconContainer.addEventListener('click', (e) => {
          e.stopPropagation();
          const emailSubjectElement = emailRowElement.querySelector('.bqe');
          const emailSubject = emailSubjectElement ? emailSubjectElement.textContent : 'No subject found';
          alert(`Brain Extension: Processing Gmail - "${emailSubject}"`);
        });

        toolbarTd.appendChild(iconContainer);
      }
    } else {
      console.log('Gmail: Toolbar TD not found for email row:', emailRowElement);
    }
  };

  // Initial injection and start monitoring
  injectAndMonitor();
  const intervalId = setInterval(injectAndMonitor, 1000); // Check every 1 second
  gmailIntervals.set(emailRowElement, intervalId);
};


// Use MutationObserver to detect new tweets and Gmail email rows
const mainObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          const element = node as HTMLElement;

          // Check for tweets
          if (element.matches('article[data-testid="tweet"]')) {
            injectIconIntoTweet(element);
          } else {
            element.querySelectorAll('article[data-testid="tweet"]').forEach(injectIconIntoTweet);
          }

          // Check for Gmail email rows
          if (element.matches('tr.zA')) {
            injectIconIntoGmailEmail(element);
          } else {
            element.querySelectorAll('tr.zA').forEach(injectIconIntoGmailEmail);
          }

          // Check for Google Calendar event detail dialog
          if (element.matches('#xDetDlg')) {
            console.log('Calendar: Detected #xDetDlg element.', element);
            injectMeetingButtonIntoCalendar(element);
          }
        }
      });
    }
  });
});

// Start observing the document body for changes
mainObserver.observe(document.body, { childList: true, subtree: true });

// Also run on initial load for any tweets and Gmail email rows already present
document.querySelectorAll('article[data-testid="tweet"]').forEach(injectIconIntoTweet);
document.querySelectorAll('tr.zA').forEach(injectIconIntoGmailEmail);
document.querySelectorAll('#xDetDlg').forEach(injectMeetingButtonIntoCalendar);