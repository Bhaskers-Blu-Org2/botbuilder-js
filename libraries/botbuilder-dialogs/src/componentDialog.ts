/**
 * @module botbuilder-dialogs
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { TurnContext, BotTelemetryClient, NullTelemetryClient } from 'botbuilder-core';
import { Dialog, DialogInstance, DialogReason, DialogTurnResult, DialogTurnStatus, DialogConsultation, DialogConsultationDesire } from './dialog';
import { DialogContext, DialogState } from './dialogContext';
import { DialogSet } from './dialogSet';
import { DialogContainer } from './dialogContainer';
import { StateMap } from './stateMap';

const PERSISTED_DIALOG_STATE: string = 'dialogs';

/**
 * Base class for a dialog that contains other child dialogs.
 *
 * @remarks
 * Component dialogs let you break your bot's logic up into components that can themselves be added
 * as a dialog to another `ComponentDialog` or `DialogSet`. Components can also be exported as part
 * of a node package and used within other bots.
 *
 * To define a new component derive a class from ComponentDialog and add your child dialogs within
 * the classes constructor:
 *
 * ```JavaScript
 * const { ComponentDialog, WaterfallDialog, TextPrompt, NumberPrompt } = require('botbuilder-dialogs);
 *
 * class FillProfileDialog extends ComponentDialog {
 *     constructor(dialogId) {
 *         super(dialogId);
 *
 *         // Add control flow dialogs
 *         this.addDialog(new WaterfallDialog('start', [
 *             async (step) => {
 *                 // Ask user their name
 *                 return await step.prompt('namePrompt', `What's your name?`);
 *             },
 *             async (step) => {
 *                 // Remember the users answer
 *                 step.values['name'] = step.result;
 *
 *                 // Ask user their age.
 *                 return await step.prompt('agePrompt', `Hi ${step.values['name']}. How old are you?`);
 *             },
 *             async (step) => {
 *                 // Remember the users answer
 *                 step.values['age'] = step.result;
 *
 *                 // End the component and return the completed profile.
 *                 return await step.endDialog(step.values);
 *             }
 *         ]));
 *
 *         // Add prompts
 *         this.addDialog(new TextPrompt('namePrompt'));
 *         this.addDialog(new NumberPrompt('agePrompt'))
 *     }
 * }
 * module.exports.FillProfileDialog = FillProfileDialog;
 * ```
 *
 * You can then add new instances of your component to another `DialogSet` or `ComponentDialog`:
 *
 * ```JavaScript
 * const dialogs = new DialogSet(dialogState);
 * dialogs.add(new FillProfileDialog('fillProfile'));
 * ```
 * @param O (Optional) options that can be passed into the `DialogContext.beginDialog()` method.
 */
export class ComponentDialog<O extends object = {}> extends DialogContainer<O> {

    /**
     * ID of the child dialog that should be started anytime the component is started.
     *
     * @remarks
     * This defaults to the ID of the first child dialog added using [addDialog()](#adddialog).
     */
    protected initialDialogId: string;

    protected onComputeID(): string {
        return `component[${this.bindingPath()}]`;
    }

    public async beginDialog(outerDC: DialogContext, options?: O): Promise<DialogTurnResult> {
        // Start the inner dialog.
        const innerDC = this.createChildContext(outerDC);
        const turnResult: DialogTurnResult<any> = await this.onBeginDialog(innerDC, options);

        // Check for end of inner dialog
        if (turnResult.status !== DialogTurnStatus.waiting) {
            // Return result to calling dialog
            return await this.endComponent(outerDC, turnResult.result);
        } else {
            // Just signal end of turn
            return Dialog.EndOfTurn;
        }
    }

    public async consultDialog(outerDC: DialogContext): Promise<DialogConsultation> {
        // Consult the inner dialog.
        const innerDC = this.createChildContext(outerDC);
        const innerConsultation = await this.onConsultDialog(innerDC);

        // Call onContinueDialog() with inner consultation
        // - The default implementation of onContinueDialog() will simply invoke the inner processor 
        //   that was returned. 
        // - This lets legacy components that have added custom interruption logic to continue to 
        //   operate as designed.
        return {
            desire: innerConsultation ? innerConsultation.desire : DialogConsultationDesire.canProcess,
            processor: (outerDC) => this.onContinueDialog(innerDC, innerConsultation)
        }
    }

    public async resumeDialog(dc: DialogContext, reason: DialogReason, result?: any): Promise<DialogTurnResult> {
        // Containers are typically leaf nodes on the stack but the dev is free to push other dialogs
        // on top of the stack which will result in the container receiving an unexpected call to
        // resumeDialog() when the pushed on dialog ends.
        // To avoid the container prematurely ending we need to implement this method and simply
        // ask our inner dialog stack to re-prompt.
        await this.repromptDialog(dc.context, dc.activeDialog);

        return Dialog.EndOfTurn;
    }

    public async repromptDialog(context: TurnContext, instance: DialogInstance): Promise<void> {
        // Forward to inner dialogs
        const innerDC = this.createInnerDC(context, instance);
        await innerDC.repromptDialog();

        // Notify component.
        await this.onRepromptDialog(context, instance);
    }

    public async endDialog(context: TurnContext, instance: DialogInstance, reason: DialogReason): Promise<void> {
        // Forward cancel to inner dialogs
        if (reason === DialogReason.cancelCalled) {
            const innerDC = this.createInnerDC(context, instance);
            await innerDC.cancelAllDialogs();
        }

        // Notify component
        await this.onEndDialog(context, instance, reason);
    }

    public createChildContext(dc: DialogContext): DialogContext | undefined {
        const childDC = this.createInnerDC(dc.context, dc.activeDialog, dc.state.user, dc.state.conversation);
        childDC.parent = dc;
        return childDC.stack.length > 0 ? childDC : undefined;
    }

    /**
     * Adds a child dialog or prompt to the components internal `DialogSet`.
     *
     * @remarks
     * The `Dialog.id` of the first child added to the component will be assigned to the [initialDialogId](#initialdialogid)
     * property.
     * @param dialog The child dialog or prompt to add.
     */
    public addDialog(dialog: Dialog): this {
        super.addDialog(dialog);
        if (this.initialDialogId === undefined) { this.initialDialogId = dialog.id; }

        return this;
    }

    /**
     * Called anytime an instance of the component has been started.
     *
     * @remarks
     * SHOULD be overridden by components that wish to perform custom interruption logic. The
     * default implementation calls `innerDC.beginDialog()` with the dialog assigned to
     * [initialDialogId](#initialdialogid).
     * @param innerDC Dialog context for the components internal `DialogSet`.
     * @param options (Optional) options that were passed to the component by its parent.
     */
    protected onBeginDialog(innerDC: DialogContext, options?: O): Promise<DialogTurnResult> {
        return innerDC.beginDialog(this.initialDialogId, options);
    }

    /**
     * Called anytime a multi-turn component is being consulted about its desire to process
     * a given utterance.
     *
     * @remarks
     * SHOULD be overridden by components that wish to perform custom interruption logic. The
     * default implementation calls `innerDC.consultDialog()` and passes through any consultations
     * with a desire of `DialogConsultationDesire.shouldProcess`.  For backwards compatibility
     * reasons, consultations with a desire of `DialogConsultationDesire.canProcess` will have their
     * processor function replaced with one that calls [onContinueDialog()][#oncontinuedialog].
     * @param innerDC Dialog context for the components internal `DialogSet`.
     */
    protected async onConsultDialog(innerDC: DialogContext): Promise<DialogConsultation|undefined> {
        return await innerDC.consultDialog();
    } 

    /**
     * Legacy dialog continuation override.
     *
     * @remarks
     * Derived classes should override [onConsultDialog()](#onconsultdialog) instead.
     * @param innerDC Dialog context for the components internal `DialogSet`.
     * @param consultation (Optional) consultation from [consultDialog()](#consultDialog) call. Invoking the processor on this object is more efficient the calling `innerDC.continueDialog()`.
     */
    protected onContinueDialog(innerDC: DialogContext, consultation?: DialogConsultation): Promise<DialogTurnResult> {
        return consultation ? consultation.processor(innerDC) : innerDC.continueDialog();
    }

    /**
     * Called when the component is ending.
     *
     * @remarks
     * If the `reason` code is equal to `DialogReason.cancelCalled`, then any active child dialogs
     * will be cancelled before this method is called.
     * @param context Context for the current turn of conversation.
     * @param instance The components instance data within its parents dialog stack.
     * @param reason The reason the component is ending.
     */
    protected onEndDialog(context: TurnContext, instance: DialogInstance, reason: DialogReason): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Called when the component has been requested to re-prompt the user for input.
     *
     * @remarks
     * The active child dialog will have already been asked to reprompt before this method is called.
     * @param context Context for the current turn of conversation.
     * @param instance The instance of the current dialog.
     */
    protected onRepromptDialog(context: TurnContext, instance: DialogInstance): Promise<void> {
        return Promise.resolve();
    }

    /**
     * Called when the components last active child dialog ends and the component is ending.
     *
     * @remarks
     * SHOULD be overridden by components that wish to perform custom logic before the component
     * ends.  The default implementation calls `outerDC.endDialog()` with the `result` returned
     * from the last active child dialog.
     * @param outerDC Dialog context for the parents `DialogSet`.
     * @param result Result returned by the last active child dialog. Can be a value of `undefined`.
     */
    protected endComponent(outerDC: DialogContext, result: any): Promise<DialogTurnResult> {
        return outerDC.endDialog(result);
    }

    /**
     * Set the telemetry client, and also apply it to all child dialogs.
     * Future dialogs added to the component will also inherit this client.
     */
    public set telemetryClient(client: BotTelemetryClient) {
        this._telemetryClient = client ? client : new NullTelemetryClient();
        this.dialogs.telemetryClient = client;
    }

     /**
     * Get the current telemetry client.
     */
    public get telemetryClient(): BotTelemetryClient {
        return this._telemetryClient;
    }

    private createInnerDC(context: TurnContext, instance: DialogInstance, userState?: StateMap, conversationState?: StateMap): DialogContext {
        const state: DialogState = instance.state[PERSISTED_DIALOG_STATE];
        if (!Array.isArray(state.dialogStack)) { state.dialogStack = [] }
        const innerDC: DialogContext = new DialogContext(this.dialogs, context, state, userState || new StateMap({}), conversationState || new StateMap({}));
        return innerDC;
    }
}
