// Pre-deployment script example
// Place your Apex scripts here to run BEFORE deployment
// They will be executed automatically in alphabetical order
//
// Example use cases:
//   - Disable automation/triggers before deploying
//   - Set custom settings or feature flags
//   - Back up or prepare data

System.debug('Pre-deployment script executed.');

// Uncomment and adapt the example below:
//
// List<TriggerSettings__c> settings = TriggerSettings__c.getAll().values();
// for (TriggerSettings__c s : settings) {
//     s.IsActive__c = false;
// }
// update settings;

