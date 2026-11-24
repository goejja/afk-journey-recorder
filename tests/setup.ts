import { beforeEach } from 'vitest';
import { clearAnswers } from '../web/answers.js';

// The web app keeps the answers of reference reads for the life of the page (web/answers.ts); each test starts as a freshly opened page.
beforeEach(() => clearAnswers());
