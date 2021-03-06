angular.module('proton.core')
.factory('memberModal', (
    pmModal,
    CONSTANTS,
    eventManager,
    gettextCatalog,
    memberApi,
    networkActivityTracker,
    notify,
    pmcw,
    organizationModel,
    MemberKey,
    authentication,
    Address,
    setupKeys
    ) => {
    return pmModal({
        controllerAs: 'ctrl',
        templateUrl: 'templates/modals/member.tpl.html',
        controller(params) {
            // Variables
            const self = this;
            const organization = organizationModel.get();
            const giga = CONSTANTS.BASE_SIZE * CONSTANTS.BASE_SIZE * CONSTANTS.BASE_SIZE;
            const minPadding = (params.member) ? params.member.UsedSpace : 0;
            const maxPadding = (params.member) ? (organization.MaxSpace - organization.AssignedSpace + params.member.MaxSpace) : organization.MaxSpace - organization.AssignedSpace;
            const fiveGigabit = 5 * giga;
            const startNewMember = (maxPadding > fiveGigabit) ? fiveGigabit : maxPadding;
            const startValue = (params.member) ? params.member.MaxSpace : startNewMember;
            // Default Parameters
            self.ID = null;
            self.step = 'member';
            self.size = 2048;
            self.organization = params.organization;
            self.organizationKey = params.organizationKey;
            self.domains = params.domains;
            self.domain = params.domains[0];
            self.name = '';
            self.temporaryPassword = '';
            self.confirmPassword = '';
            self.address = '';
            self.unit = giga;
            self.min = 0;
            self.max = organization.MaxSpace;
            self.sliderOptions = {
                animate: false,
                start: startValue / self.unit,
                step: 0.1,
                connect: [true, false],
                tooltips: true,
                range: { min: self.min / self.unit, max: self.max / self.unit },
                pips: {
                    mode: 'values',
                    values: [0, self.max / self.unit],
                    density: 4
                },
                minPadding: minPadding / self.unit,
                maxPadding: maxPadding / self.unit
            };

            const allocatedLegend = { label: gettextCatalog.getString('Allocated', null), classes: 'background-primary' };
            const minPaddingLegend = { label: gettextCatalog.getString('Already used', null), classes: 'background-red-striped' };
            const maxPaddingLegend = { label: gettextCatalog.getString('Already allocated', null), classes: 'background-yellow-striped' };

            self.legends = [allocatedLegend];
            minPadding > 0 && self.legends.push(minPaddingLegend);
            maxPadding > 0 && self.legends.push(maxPaddingLegend);

            self.isPrivate = false;
            self.private = false;
            self.showAddress = true;
            self.showKeys = true;

            // Edit mode
            if (params.member) {
                self.oldMember = _.extend({}, params.member);
                self.ID = params.member.ID;
                self.name = params.member.Name;
                self.private = Boolean(params.member.Private);
                self.isPrivate = Boolean(params.member.Private);
                self.showAddress = params.member.Addresses.length === 0 && params.member.Type === 1;
                self.showKeys = params.member.Keys.length === 0 && !self.isPrivate;
            }

            // Functions
            self.submit = () => {
                let mainPromise;
                let addresses = [];
                let notificationMessage;
                let member = {};
                const quota = getQuota();

                if (params.member) {
                    _.extend(member, params.member);
                }

                member.Name = self.name;
                member.Private = self.private ? 1 : 0;
                member.MaxSpace = quota;

                const check = () => {
                    if (self.name.length === 0) {
                        return Promise.reject(gettextCatalog.getString('Invalid name', null, 'Error'));
                    } else if ((!member.ID || (!member.Private && params.member.Keys.length === 0)) && self.temporaryPassword !== self.confirmPassword) {
                        return Promise.reject(gettextCatalog.getString('Invalid password', null, 'Error'));
                    } else if ((!member.ID || (params.member.Addresses.length === 0 && params.member.Type === 1)) && self.address.length === 0) {
                        return Promise.reject(gettextCatalog.getString('Invalid address', null, 'Error'));
                    } else if (quota > maxPadding || quota < minPadding) {
                        return Promise.reject(gettextCatalog.getString('Invalid storage quota', null, 'Error'));
                    } else if (!member.ID && !member.Private && !self.organizationKey) {
                        return Promise.reject(gettextCatalog.getString('Cannot decrypt organization key', null, 'Error'));
                    }
                    return Promise.resolve();
                };

                const updateName = () => {
                    if (self.oldMember && self.oldMember.Name === self.name) {
                        return Promise.resolve();
                    }

                    return memberApi.name(member.ID, self.name)
                        .then(({ data = {} }) => {
                            if (data.Code === 1000) {
                                member.Name = self.name;
                                return;
                            }
                            throw new Error(data.Error || 'Request error');
                        });
                };

                const updateQuota = () => {
                    if (self.oldMember && self.oldMember.MaxSpace === quota) {
                        return Promise.resolve();
                    }

                    return memberApi.quota(member.ID, quota)
                        .then(({ data = {} }) => {
                            if (data.Code === 1000) {
                                member.MaxSpace = quota;
                                return;
                            }
                            throw new Error(data.Error || 'Request error');
                        });
                };

                const memberRequest = () => {
                    return memberApi.create(member, self.temporaryPassword)
                        .then(({ data = {} }) => {
                            if (data.Code === 1000) {
                                member = data.Member;
                                return;
                            }
                            throw new Error(data.Error || 'Request error');
                        });
                };

                const addressRequest = () => {
                    if (params.member && params.member.Addresses.length) {
                        return Promise.resolve();
                    }

                    return Address.create({
                        Local: self.address,
                        Domain: self.domain.DomainName,
                        MemberID: member.ID
                    })
                        .then(({ data = {} }) => {
                            if (data.Code === 1000) {
                                member.Addresses.push(data.Address);
                                addresses.push(data.Address);
                                return;
                            }
                            throw new Error(data.Error || 'Request error');
                        });
                };

                const generateKey = () => {

                    if (member.Private || (params.member && params.member.Keys.length > 0)) {
                        return Promise.resolve();
                    }

                    if (addresses.length === 0) {
                        addresses = params.member.Addresses;
                    }

                    return setupKeys.generate(addresses, self.temporaryPassword, self.size);
                };

                const keyRequest = (result) => {

                    if (member.Private || (params.member && params.member.Keys.length > 0)) {
                        return Promise.resolve();
                    }

                    return setupKeys.memberSetup(result, self.temporaryPassword, member.ID, self.organizationKey)
                    .then((result) => {
                        member = result;
                    });
                };

                const finish = () => {
                    notify({ message: notificationMessage, classes: 'notification-success' });
                    return eventManager.call()
                    .then(() => params.submit(member));
                };

                const error = (error) => {
                    notify({ message: error, classes: 'notification-danger' });
                    return eventManager.call();
                };

                if (self.ID) {
                    member.ID = self.ID;
                    notificationMessage = gettextCatalog.getString('Member updated', null, 'Notification');
                    mainPromise = check()
                    .then(updateName)
                    .then(updateQuota);
                } else {
                    notificationMessage = gettextCatalog.getString('Member created', null, 'Notification');
                    mainPromise = check().then(memberRequest);
                }

                mainPromise = mainPromise
                .then(addressRequest)
                .then(generateKey)
                .then(keyRequest)
                .then(finish)
                .catch(error);

                networkActivityTracker.track(mainPromise);
            };

            self.cancel = () => {
                params.cancel();
            };

            function getQuota() {
                return Math.round(self.sliderValue * self.unit);
            }
        }
    });
});
