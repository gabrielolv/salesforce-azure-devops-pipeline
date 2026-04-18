// Post-deployment script example
// Place your Apex scripts here to run AFTER deployment
// They will be executed automatically in alphabetical order
//
// Example use cases:
//   - Re-enable automation/triggers after deploying
//   - Seed or migrate data for new fields/objects
//   - Send notifications or update configuration records
 
System.debug('Post-deployment script executed.');

// Uncomment and adapt the example below:
//
// List<TriggerSettings__c> settings = TriggerSettings__c.getAll().values();
// for (TriggerSettings__c s : settings) {
//     s.IsActive__c = true;
// }
// update settings;
